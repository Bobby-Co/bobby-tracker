// VCS module — the RLS-scoped READ side of the PR mirror (pull_requests +
// pull_request_analyses + pr_comments). Distinct from PullRequestStore, which is
// the service-role write/sync side. The PR tab routes read through this contract.

import type { PrComment, PrFinding, PullRequest, PullRequestAnalysis, ReviewRoundCommit, ReviewRunProfile } from "@/lib/shared/types"

/** The ownership fields for a mirrored comment (who authored it, from where). */
export interface CommentOwnership {
    provenance: string
    author_user_id: string | null
    pr_number: number
}

/** One completed review of one head (0080/0081), as the PR page reads it.
 *
 *  A SNAPSHOT, not a delta. Every round holds its own complete findings list, so
 *  "show me the review as it stood at round 2" is one row read — no replay, no
 *  reconstruction, and no risk of a rendered history that disagrees with what
 *  the merge gate saw at the time. That is the whole reason the round selector
 *  in the panel is a row read rather than a replay engine. */
export interface PullRequestRound {
    headSha: string
    round: number
    verdict: string | null
    score: number | null
    scoreMax: number | null
    findings: PrFinding[]
    degraded: boolean
    reviewProfile: ReviewRunProfile | null
    createdAt: string
    /** What this round reviewed, and which rule chose it (0081). */
    scope: "full" | "incremental"
    scopeReason: string | null
    /** The commits this round covered — the strip doubles as the series of
     *  pushes. */
    commits: ReviewRoundCommit[]
    /** How many of `findings` rode along without being re-examined. */
    carriedCount: number
    /** Blockers the previous round had that this one does not, each stamped with
     *  the head that closed it. Kept out of `findings` so the merge gate stays
     *  clean, and kept at all so a reader can see what their push fixed. */
    resolved: PrFinding[]
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

    /** The review rounds for a PR, NEWEST FIRST, capped. Empty when the PR has
     *  only ever been reviewed once — the surfaces read that as "no story yet"
     *  rather than as an error. THROWS on query failure. */
    listAnalysisRounds(projectId: string, prNumber: number, limit: number): Promise<PullRequestRound[]>

    /** The synced comment thread for a PR, oldest first. THROWS on query failure. */
    listComments(projectId: string, prNumber: number): Promise<PrComment[]>

    /** Ownership fields for a mirrored comment by GitHub id, or null when absent.
     *  FAIL-SAFE (null on error), matching the route's best-effort read. */
    findCommentOwnership(projectId: string, githubCommentId: number): Promise<CommentOwnership | null>
}
