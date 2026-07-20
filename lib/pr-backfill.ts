// One-off backfill for the PR mirror: pulls a repo's existing pull requests (and
// the most-recent threads) from GitHub into tracker.pull_requests / pr_comments,
// so the Pull-requests tab shows history that predates the webhook wiring — the
// webhook keeps it current from here on.
//
// GitHub I/O lives here (App creds); runs detached via after() (kicked from the
// list endpoint when the table is empty, and from POST …/pulls/sync). All writes
// go through the service-role client, mirroring lib/pr-sync.ts.

import {
    listIssueComments,
    listPullRequestReviews,
    listPullRequests,
    type GithubPullRequest,
} from "@/lib/github-app-rest"
import { repoFullName } from "@/lib/integrations/github"
import { upsertIssueComment } from "@/lib/issue-store"
import { upsertPRComment, upsertPullRequest, type PRUpsert } from "@/lib/pr-store"
import { createServiceClient } from "@/lib/supabase/server"
import type { Project } from "@/lib/supabase/types"

type Svc = ReturnType<typeof createServiceClient>

// Comment/review threads are the expensive part (2 API calls per PR), so on a
// full backfill we only pull them for the N most-recently-updated PRs (the list
// is sorted updated-desc). Older PRs fill their thread lazily on detail open.
const COMMENT_BACKFILL_MAX = 40

type PRProject = Pick<Project, "id" | "repo_url" | "repo_full_name"> & {
    github_installation_id: number | null
    github_repo_id: number | null
    github_sync_enabled: boolean
}

const PR_PROJECT_COLS =
    "id,repo_url,repo_full_name,github_installation_id,github_repo_id,github_sync_enabled"

type Creds = { installationId: number; owner: string; repo: string }

// Resolve the App creds + owner/repo for a sync-enabled, App-linked project.
async function resolveCreds(svc: Svc, projectId: string): Promise<Creds | null> {
    const { data: project } = await svc
        .from("projects")
        .select(PR_PROJECT_COLS)
        .eq("id", projectId)
        .maybeSingle<PRProject>()
    if (!project) return null
    if (!project.github_sync_enabled || project.github_installation_id == null || project.github_repo_id == null) {
        return null
    }
    const full = repoFullName(project)
    if (!full) return null
    const [owner, repo] = full.split("/")
    return { installationId: project.github_installation_id, owner, repo }
}

function prRowFromRest(pr: GithubPullRequest): PRUpsert {
    return {
        pr_number: pr.number,
        github_node_id: pr.node_id ?? null,
        title: pr.title ?? "",
        body: pr.body ?? null,
        state: pr.state === "closed" ? "closed" : "open",
        merged: !!pr.merged_at,
        draft: !!pr.draft,
        author_login: pr.user?.login ?? null,
        author_avatar_url: pr.user?.avatar_url ?? null,
        html_url: pr.html_url ?? null,
        head_ref: pr.head?.ref ?? null,
        base_ref: pr.base?.ref ?? null,
        head_sha: pr.head?.sha ?? null,
        base_sha: pr.base?.sha ?? null,
        // additions/deletions/changed_files/comments are absent on the /pulls
        // list — left undefined so the upsert doesn't clobber values a
        // synchronize webhook may have already set.
        additions: pr.additions,
        deletions: pr.deletions,
        changed_files: pr.changed_files,
        comments_count: pr.comments,
        gh_created_at: pr.created_at ?? null,
        gh_updated_at: pr.updated_at ?? null,
        closed_at: pr.closed_at ?? null,
        merged_at: pr.merged_at ?? null,
    }
}

// Pull a single PR's conversation comments + review summaries into pr_comments.
async function syncComments(svc: Svc, projectId: string, creds: Creds, prNumber: number): Promise<void> {
    const { installationId, owner, repo } = creds
    const [comments, reviews] = await Promise.all([
        listIssueComments(installationId, owner, repo, prNumber).catch(() => []),
        listPullRequestReviews(installationId, owner, repo, prNumber).catch(() => []),
    ])
    for (const c of comments) {
        await upsertPRComment(svc, projectId, {
            pr_number: prNumber,
            source: "issue_comment",
            github_comment_id: c.id,
            author_login: c.user?.login ?? null,
            author_avatar_url: c.user?.avatar_url ?? null,
            body: c.body ?? null,
            html_url: c.html_url ?? null,
            gh_created_at: c.created_at ?? null,
            gh_updated_at: c.updated_at ?? null,
        })
    }
    for (const r of reviews) {
        if (!r.body?.trim()) continue // bodiless approvals are status, not comments
        await upsertPRComment(svc, projectId, {
            pr_number: prNumber,
            source: "review",
            github_comment_id: r.id,
            author_login: r.user?.login ?? null,
            author_avatar_url: r.user?.avatar_url ?? null,
            body: r.body,
            html_url: r.html_url ?? null,
            gh_created_at: r.submitted_at ?? null,
            gh_updated_at: r.submitted_at ?? null,
        })
    }
}

// backfillPullRequests mirrors all of a repo's PRs (metadata) plus the threads of
// the most-recently-updated ones. No-ops silently when the project isn't
// App-linked / sync-enabled.
export async function backfillPullRequests(projectId: string): Promise<void> {
    const svc = createServiceClient()
    const creds = await resolveCreds(svc, projectId)
    if (!creds) return

    let prs: GithubPullRequest[]
    try {
        prs = await listPullRequests(creds.installationId, creds.owner, creds.repo, { state: "all" })
    } catch {
        return
    }

    for (const pr of prs) {
        await upsertPullRequest(svc, projectId, prRowFromRest(pr))
    }
    for (const pr of prs.slice(0, COMMENT_BACKFILL_MAX)) {
        await syncComments(svc, projectId, creds, pr.number)
    }
}

// backfillPullRequestComments fills one PR's thread on demand (kicked from the
// detail endpoint when a PR has no synced comments yet — e.g. an older PR beyond
// the full-backfill cap).
export async function backfillPullRequestComments(projectId: string, prNumber: number): Promise<void> {
    const svc = createServiceClient()
    const creds = await resolveCreds(svc, projectId)
    if (!creds) return
    await syncComments(svc, projectId, creds, prNumber)
}

// backfillIssueComments fills one issue's conversation thread on demand (kicked
// from the issue-detail endpoint when the thread is empty). Upserts omit
// provenance, so a tracker-authored comment already present keeps its ownership.
export async function backfillIssueComments(projectId: string, issueNumber: number): Promise<void> {
    const svc = createServiceClient()
    const creds = await resolveCreds(svc, projectId)
    if (!creds) return
    const comments = await listIssueComments(creds.installationId, creds.owner, creds.repo, issueNumber).catch(
        () => [],
    )
    for (const c of comments) {
        await upsertIssueComment(svc, projectId, {
            issue_number: issueNumber,
            github_comment_id: c.id,
            author_login: c.user?.login ?? null,
            author_avatar_url: c.user?.avatar_url ?? null,
            body: c.body ?? null,
            html_url: c.html_url ?? null,
            gh_created_at: c.created_at ?? null,
            gh_updated_at: c.updated_at ?? null,
        })
    }
}
