// VCS module — the PR-mirror repository PORT. The persistence of tracker's copy
// of a repo's pull requests + their comment threads (tracker.pull_requests /
// pr_comments) and the read of the stored review result. The PullRequestService
// and the PR routes depend on this interface; the service-role Supabase adapter
// lives in ../infrastructure. Replaces the old free-function pr-store.

import type { PRAnalysis } from "@/lib/supabase/types"

/** A PR metadata upsert. Fields left `undefined` are dropped from the write so a
 *  poorer source (e.g. the /pulls list, which omits additions/deletions) never
 *  clobbers a value a richer event already set. */
export type PRUpsert = {
    pr_number: number
    github_node_id?: string | null
    title: string
    body?: string | null
    state: "open" | "closed"
    merged: boolean
    draft: boolean
    author_login?: string | null
    author_avatar_url?: string | null
    html_url?: string | null
    head_ref?: string | null
    base_ref?: string | null
    head_sha?: string | null
    base_sha?: string | null
    additions?: number | null
    deletions?: number | null
    changed_files?: number | null
    comments_count?: number | null
    gh_created_at?: string | null
    gh_updated_at?: string | null
    closed_at?: string | null
    merged_at?: string | null
}

export type PRCommentSource = "issue_comment" | "review" | "review_comment"

export type PRCommentUpsert = {
    pr_number: number
    source: PRCommentSource
    github_comment_id: number
    provenance?: "github" | "tracker"
    author_user_id?: string | null
    author_login?: string | null
    author_avatar_url?: string | null
    body?: string | null
    html_url?: string | null
    gh_created_at?: string | null
    gh_updated_at?: string | null
}

export interface PullRequestStore {
    /** Upsert a PR's mirrored metadata (conflict on project_id,pr_number). */
    upsertPullRequest(projectId: string, pr: PRUpsert): Promise<void>
    /** Upsert one mirrored PR comment (conflict on project_id,source,comment id). */
    upsertComment(projectId: string, comment: PRCommentUpsert): Promise<void>
    /** Delete one mirrored PR comment. */
    deleteComment(projectId: string, source: PRCommentSource, commentId: number): Promise<void>
    /** Reflect a completed merge on the mirror (closed + merged, `at` timestamps)
     *  so the UI updates without waiting on the webhook's `closed` event. */
    markMerged(projectId: string, prNumber: number, at: string): Promise<void>
    /** The stored review result for one PR, or null when none. */
    findAnalysisResult(projectId: string, prNumber: number): Promise<PRAnalysis | null>
}
