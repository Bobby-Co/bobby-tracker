// VCS module — the RLS-scoped READ side of the PR mirror (pull_requests +
// pull_request_analyses + pr_comments). Distinct from PullRequestStore, which is
// the service-role write/sync side. The PR tab routes read through this contract.

import type { PrComment, PullRequest, PullRequestAnalysis } from "@/lib/shared/types"

/** The ownership fields for a mirrored comment (who authored it, from where). */
export interface CommentOwnership {
    provenance: string
    author_user_id: string | null
    pr_number: number
}

export interface PullRequestReadRepository {
    /** The project's mirrored PRs, newest gh_updated_at first, capped. THROWS. */
    listForProject(projectId: string): Promise<PullRequest[]>

    /** Review-status per PR number for the project. THROWS. */
    listAnalysisStatuses(projectId: string): Promise<Pick<PullRequestAnalysis, "pr_number" | "status">[]>

    /** One mirrored PR by number, or null when absent. THROWS on query failure. */
    findByNumber(projectId: string, prNumber: number): Promise<PullRequest | null>

    /** The full persisted review for a PR, or null. THROWS on query failure. */
    findAnalysis(projectId: string, prNumber: number): Promise<PullRequestAnalysis | null>

    /** Just the review status for a PR (or null when absent). THROWS on failure. */
    findAnalysisStatus(projectId: string, prNumber: number): Promise<PullRequestAnalysis["status"] | null>

    /** The synced comment thread for a PR, oldest first. THROWS on query failure. */
    listComments(projectId: string, prNumber: number): Promise<PrComment[]>

    /** Ownership fields for a mirrored comment by GitHub id, or null when absent.
     *  FAIL-SAFE (null on error), matching the route's best-effort read. */
    findCommentOwnership(projectId: string, githubCommentId: number): Promise<CommentOwnership | null>
}
