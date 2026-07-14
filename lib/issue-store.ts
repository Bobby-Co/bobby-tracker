// Upserts for the issue comment mirror (tracker.issue_comments) — the issue-side
// twin of lib/pr-store.ts. Written by the webhook + backfill (provenance
// 'github') and the authoring routes (provenance 'tracker'). Undefined fields
// are dropped so a sparse source never clobbers a richer one.

import type { createServiceClient } from "@/lib/supabase/server"

type Svc = ReturnType<typeof createServiceClient>

export type IssueCommentUpsert = {
    issue_number: number
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

export async function upsertIssueComment(svc: Svc, projectId: string, c: IssueCommentUpsert): Promise<void> {
    await svc
        .from("issue_comments")
        .upsert({ project_id: projectId, ...c }, { onConflict: "project_id,github_comment_id" })
}

export async function deleteIssueComment(svc: Svc, projectId: string, commentId: number): Promise<void> {
    await svc
        .from("issue_comments")
        .delete()
        .eq("project_id", projectId)
        .eq("github_comment_id", commentId)
}
