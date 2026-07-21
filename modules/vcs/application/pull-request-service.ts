// VCS application — PullRequestService: the provider-agnostic orchestrator for
// the PR mirror. It backfills a repo's pull requests + their comment threads from
// the remote into tracker's mirror, expressed purely over two ports:
//   • VCSAppInstance     — the remote reads (listPullRequests/…); vendor-neutral.
//   • PullRequestStore   — our mirror persistence (pull_requests / pr_comments).
// Issue-comment backfill shares the same remote-comment machinery, so it lives
// here too, writing through an injected issue-comment sink (the issues context
// owns that table). No tokens, owner/repo, REST, or DB SDK — those are wired at
// the composition root.
//
// Pure application: imports only ports + neutral DTOs (enforced by the DIP rule).

import type { IssueCommentUpsert } from "@/modules/issues"
import type { VCSAppInstance } from "../ports/vcs-app-instance"
import type { PRUpsert, PullRequestStore } from "../ports/pull-request-store"
import type { VcsComment, VcsPullRequest, VcsReview } from "../ports/vcs-types"

// Comment/review threads are the expensive part (2 API calls per PR), so a full
// backfill only pulls them for the N most-recently-updated PRs. Older PRs fill
// their thread lazily on detail open.
const COMMENT_BACKFILL_MAX = 40

/** Writes one mirrored issue comment (the issues context owns that table). */
export type IssueCommentSink = (projectId: string, comment: IssueCommentUpsert) => Promise<void>

function prRow(pr: VcsPullRequest): PRUpsert {
    return {
        pr_number: pr.number,
        github_node_id: pr.nodeId ?? null,
        title: pr.title ?? "",
        body: pr.body ?? null,
        state: pr.state === "closed" ? "closed" : "open",
        merged: pr.mergedAt != null,
        draft: pr.draft,
        author_login: pr.author?.login ?? null,
        author_avatar_url: pr.author?.avatarUrl ?? null,
        html_url: pr.url ?? null,
        head_ref: pr.head?.ref ?? null,
        base_ref: pr.base?.ref ?? null,
        head_sha: pr.head?.sha ?? null,
        base_sha: pr.base?.sha ?? null,
        // additions/deletions/changed_files/comments are absent on the list read
        // → left undefined so a synchronize event's richer values aren't clobbered.
        additions: pr.additions,
        deletions: pr.deletions,
        changed_files: pr.changedFiles,
        comments_count: pr.comments,
        gh_created_at: pr.createdAt ?? null,
        gh_updated_at: pr.updatedAt ?? null,
        closed_at: pr.closedAt ?? null,
        merged_at: pr.mergedAt ?? null,
    }
}

export class PullRequestService {
    constructor(
        private readonly vcs: VCSAppInstance,
        private readonly store: PullRequestStore,
        private readonly issueComments: IssueCommentSink,
    ) {}

    /** Mirror all of a repo's PRs (metadata) plus the threads of the most-
     *  recently-updated ones. */
    async backfillPullRequests(projectId: string): Promise<void> {
        let prs: VcsPullRequest[]
        try {
            prs = await this.vcs.listPullRequests({ state: "all" })
        } catch {
            return
        }
        for (const pr of prs) await this.store.upsertPullRequest(projectId, prRow(pr))
        for (const pr of prs.slice(0, COMMENT_BACKFILL_MAX)) await this.syncComments(projectId, pr.number)
    }

    /** Fill one PR's thread on demand (older PR beyond the full-backfill cap). */
    async backfillPullRequestComments(projectId: string, prNumber: number): Promise<void> {
        await this.syncComments(projectId, prNumber)
    }

    /** Fill one issue's conversation thread on demand. Upserts omit provenance so
     *  a tracker-authored comment already present keeps its ownership. */
    async backfillIssueComments(projectId: string, issueNumber: number): Promise<void> {
        const comments = await this.vcs.listIssueComments(issueNumber).catch((): VcsComment[] => [])
        for (const c of comments) {
            await this.issueComments(projectId, {
                issue_number: issueNumber,
                github_comment_id: c.id,
                author_login: c.author?.login ?? null,
                author_avatar_url: c.author?.avatarUrl ?? null,
                body: c.body ?? null,
                html_url: c.url ?? null,
                gh_created_at: c.createdAt ?? null,
                gh_updated_at: c.updatedAt ?? null,
            })
        }
    }

    // Pull a single PR's conversation comments + review summaries into the mirror.
    private async syncComments(projectId: string, prNumber: number): Promise<void> {
        const [comments, reviews] = await Promise.all([
            this.vcs.listIssueComments(prNumber).catch((): VcsComment[] => []),
            this.vcs.listPullRequestReviews(prNumber).catch((): VcsReview[] => []),
        ])
        for (const c of comments) {
            await this.store.upsertComment(projectId, {
                pr_number: prNumber,
                source: "issue_comment",
                github_comment_id: c.id,
                author_login: c.author?.login ?? null,
                author_avatar_url: c.author?.avatarUrl ?? null,
                body: c.body ?? null,
                html_url: c.url ?? null,
                gh_created_at: c.createdAt ?? null,
                gh_updated_at: c.updatedAt ?? null,
            })
        }
        for (const r of reviews) {
            if (!r.body?.trim()) continue // bodiless approvals are status, not comments
            await this.store.upsertComment(projectId, {
                pr_number: prNumber,
                source: "review",
                github_comment_id: r.id,
                author_login: r.author?.login ?? null,
                author_avatar_url: r.author?.avatarUrl ?? null,
                body: r.body,
                html_url: r.url ?? null,
                gh_created_at: r.submittedAt ?? null,
                gh_updated_at: r.submittedAt ?? null,
            })
        }
    }
}
