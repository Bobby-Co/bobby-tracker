// Issues module — the RLS-scoped READ side of the GitHub issue-comment mirror
// (issue_comments). Distinct from IssueSyncStore, which is the service-role
// write/sync side. The issue-detail page + comment-authoring routes read here.

import type { IssueComment } from "@/lib/shared/types"

/** Ownership fields for a mirrored issue comment (who authored it, from where). */
export interface IssueCommentOwnership {
    provenance: string
    author_user_id: string | null
    issue_number: number
}

export interface IssueCommentsReadRepository {
    /** The synced comment thread for a GitHub issue number, oldest first. THROWS. */
    listComments(projectId: string, issueNumber: number): Promise<IssueComment[]>

    /** Ownership fields for a mirrored comment by GitHub id, or null when absent.
     *  FAIL-SAFE (null on error), matching the route's best-effort read. */
    findCommentOwnership(projectId: string, githubCommentId: number): Promise<IssueCommentOwnership | null>
}
