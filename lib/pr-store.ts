// Shared upserts for the PR mirror (tracker.pull_requests + tracker.pr_comments).
// Both the webhook (app/api/webhooks/github) and the backfill (lib/pr-backfill)
// funnel through here so the row shape + conflict keys stay in one place.
//
// Upserts intentionally omit `undefined` fields: supabase-js drops them from the
// request body, and PostgREST's merge-duplicates only updates the columns it
// receives — so a source that lacks a field (e.g. the /pulls list omits
// additions/deletions) never clobbers a value an earlier, richer event set.

import type { createServiceClient } from "@/lib/supabase/server"

type Svc = ReturnType<typeof createServiceClient>

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

export async function upsertPullRequest(svc: Svc, projectId: string, pr: PRUpsert): Promise<void> {
    await svc
        .from("pull_requests")
        .upsert({ project_id: projectId, ...pr }, { onConflict: "project_id,pr_number" })
}

export type PRCommentSource = "issue_comment" | "review" | "review_comment"

export type PRCommentUpsert = {
    pr_number: number
    source: PRCommentSource
    github_comment_id: number
    author_login?: string | null
    author_avatar_url?: string | null
    body?: string | null
    html_url?: string | null
    gh_created_at?: string | null
    gh_updated_at?: string | null
}

export async function upsertPRComment(svc: Svc, projectId: string, c: PRCommentUpsert): Promise<void> {
    await svc
        .from("pr_comments")
        .upsert({ project_id: projectId, ...c }, { onConflict: "project_id,source,github_comment_id" })
}

export async function deletePRComment(
    svc: Svc,
    projectId: string,
    source: PRCommentSource,
    commentId: number,
): Promise<void> {
    await svc
        .from("pr_comments")
        .delete()
        .eq("project_id", projectId)
        .eq("source", source)
        .eq("github_comment_id", commentId)
}
