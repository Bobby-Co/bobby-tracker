// PR-analysis orchestration: on a GitHub pull_request event the tracker fetches
// the diff, posts an "analysing…" comment, kicks a DETACHED analyser run
// (/pr/analyse/run), and edits that comment in place when the analyser calls
// back (/api/internal/pr-analysis-result). Closing the PR cancels the run.
// GitHub I/O lives here (the App creds are here); the analyser is GitHub-free.
// See the analyser's ADR-0052 + pr.go/pr_async.go.

import { getAnalyser, isAnalyserReady, type PRAnalyseFile } from "@/modules/analysis"
import { createIssueComment, listPullRequestFiles, updateIssueComment } from "@/lib/github-app-rest"
import { repoFullName } from "@/lib/integrations/github"
import { createServiceClient } from "@/lib/supabase/server"
import { cancelledComment, failedComment, loadingComment, resultComment } from "@/lib/pulls/pr-comment"
import type { PRAnalysis, Project } from "@/lib/supabase/types"

// The subset of a tracker.projects row PR analysis reads.
type PRProject = Pick<Project, "id" | "repo_url" | "repo_full_name"> & {
    github_installation_id: number | null
    github_repo_id: number | null
    github_sync_enabled: boolean
}

const PR_PROJECT_COLS =
    "id,repo_url,repo_full_name,github_installation_id,github_repo_id,github_sync_enabled"

// PRInput is the PR metadata from the webhook payload.
export type PRInput = {
    number: number
    title: string
    body: string | null
    baseSha: string | null
    headSha: string | null
}

function prReady(p: PRProject): boolean {
    return p.github_sync_enabled && p.github_installation_id != null && p.github_repo_id != null
}

// startPRAnalysis gates on the App being linked + the graph indexed, fetches the
// PR diff, posts (or re-uses) the "analysing…" comment, upserts the tracking row
// (its id is the analyser task_id), and kicks the detached run. Idempotent: a
// run already in flight for this PR is left alone.
export async function startPRAnalysis(project: PRProject, pr: PRInput, origin: string): Promise<void> {
    if (!prReady(project)) return
    const full = repoFullName(project)
    if (!full) return
    const [owner, repo] = full.split("/")
    const installationId = project.github_installation_id!

    const svc = createServiceClient()

    // Gate: the graph must be indexed for the review to have codebase context.
    const { data: analyser } = await svc
        .from("project_analyser")
        .select("enabled,status,graph_id")
        .eq("project_id", project.id)
        .maybeSingle<{ enabled: boolean; status: string; graph_id: string | null }>()
    if (!isAnalyserReady(analyser)) return

    // Idempotency: don't start a second run while one is in flight for this PR.
    const { data: existing } = await svc
        .from("pull_request_analyses")
        .select("id,status,github_comment_id")
        .eq("project_id", project.id)
        .eq("pr_number", pr.number)
        .maybeSingle<{ id: string; status: string | null; github_comment_id: number | null }>()
    if (existing?.status === "analysing") return

    // Fetch the diff (per-file patches).
    let files: PRAnalyseFile[]
    try {
        const gh = await listPullRequestFiles(installationId, owner, repo, pr.number)
        files = gh.map((f) => ({
            path: f.filename,
            previous_path: f.previous_filename,
            status: f.status,
            patch: f.patch,
            additions: f.additions,
            deletions: f.deletions,
        }))
    } catch {
        return
    }
    if (files.length === 0) return

    // Loading comment: edit the prior one on a re-run, else post fresh.
    const loadingUrl = `${origin}/projects/${project.id}/pulls/${pr.number}`
    let commentId = existing?.github_comment_id ?? null
    if (commentId != null) {
        try {
            await updateIssueComment(installationId, owner, repo, commentId, loadingComment(origin, pr.title, loadingUrl))
        } catch {
            commentId = null
        }
    }
    if (commentId == null) {
        try {
            const created = await createIssueComment(installationId, owner, repo, pr.number, loadingComment(origin, pr.title, loadingUrl))
            commentId = created.id
        } catch {
            return
        }
    }

    // Upsert the tracking row — id doubles as the analyser task_id.
    const { data: row } = await svc
        .from("pull_request_analyses")
        .upsert(
            {
                project_id: project.id,
                pr_number: pr.number,
                github_comment_id: commentId,
                head_sha: pr.headSha,
                status: "analysing",
            },
            { onConflict: "project_id,pr_number" },
        )
        .select("id")
        .single<{ id: string }>()
    if (!row) return

    await getAnalyser().startPRAnalysis(
        {
            repoId: analyser.graph_id,
            number: pr.number,
            title: pr.title,
            body: pr.body || "",
            baseSha: pr.baseSha || undefined,
            headSha: pr.headSha || undefined,
            files,
            projectId: project.id,
        },
        row.id,
        { url: `${origin}/api/internal/pr-analysis-result`, token: process.env.BOBBY_ANALYSER_TOKEN },
    )
}

// applyPRResult is invoked by /api/internal/pr-analysis-result when the analyser
// reports a terminal state. It edits the PR comment in place and records status.
export async function applyPRResult(
    taskId: string,
    status: "done" | "failed" | "cancelled",
    result: PRAnalysis | null,
    origin: string,
): Promise<void> {
    const svc = createServiceClient()

    const { data: row } = await svc
        .from("pull_request_analyses")
        .select("id,project_id,pr_number,github_comment_id")
        .eq("id", taskId)
        .maybeSingle<{ id: string; project_id: string; pr_number: number; github_comment_id: number | null }>()
    if (!row) return

    if (row.github_comment_id != null) {
        const { data: project } = await svc
            .from("projects")
            .select(PR_PROJECT_COLS)
            .eq("id", row.project_id)
            .maybeSingle<PRProject>()
        if (project && prReady(project)) {
            const full = repoFullName(project)
            if (full) {
                const [owner, repo] = full.split("/")
                const uiUrl = `${origin}/projects/${row.project_id}/pulls/${row.pr_number}`
                const body =
                    status === "done" && result
                        ? resultComment(result, origin, uiUrl, row.pr_number)
                        : status === "cancelled"
                          ? cancelledComment(origin, row.pr_number)
                          : failedComment(origin, row.pr_number)
                try {
                    await updateIssueComment(project.github_installation_id!, owner, repo, row.github_comment_id, body)
                } catch {
                    // Comment may have been deleted on GitHub — don't fail the callback.
                }
            }
        }
    }

    // Persist the structured review alongside the status so the Pull-requests
    // tab can render it natively (not just via the GitHub comment). This UPDATE
    // is also what fires the 'pr_analysis_ready' feed notification (trigger in
    // migration 0049), which in turn fans out the review email via the
    // notifications → pg_net dispatch (migration 0051). No email code here — one
    // path for every notification kind.
    await svc.from("pull_request_analyses").update({ status, result: result ?? null }).eq("id", taskId)
}

// cancelPRAnalysisForPR cancels an in-flight run when a PR is closed. The
// analyser reports 'cancelled' via the callback, which updates the comment.
export async function cancelPRAnalysisForPR(projectId: string, prNumber: number): Promise<void> {
    const svc = createServiceClient()
    const { data: row } = await svc
        .from("pull_request_analyses")
        .select("id,status")
        .eq("project_id", projectId)
        .eq("pr_number", prNumber)
        .maybeSingle<{ id: string; status: string | null }>()
    if (!row || row.status !== "analysing") return
    await getAnalyser().cancelPRAnalysis(row.id)
}
