import { ApiContext, jsonError } from "@/lib/server/http/api"
import { CommentActions, VcsReauthError, createServicePullRequestStore } from "@/modules/vcs"
import type { SupabaseClient } from "@supabase/supabase-js"

// Edit / delete a PR comment the user authored from here. `commentId` is the
// GitHub comment id. Only tracker-provenance comments owned by the caller are
// writable; GitHub-origin comments are read-only mirrors (edit on GitHub).

type OwnedRow = { provenance: string; author_user_id: string | null; pr_number: number }

async function loadOwned(
    supabase: SupabaseClient,
    projectId: string,
    commentId: number,
    userId: string,
): Promise<{ row: OwnedRow } | { error: Response }> {
    const { data } = await supabase
        .from("pr_comments")
        .select("provenance,author_user_id,pr_number")
        .eq("project_id", projectId)
        .eq("github_comment_id", commentId)
        .maybeSingle<OwnedRow>()
    if (!data) return { error: jsonError("not_found", "comment not found", 404) }
    if (data.provenance !== "tracker" || data.author_user_id !== userId) {
        return { error: jsonError("forbidden", "you can only edit comments you posted from here", 403) }
    }
    return { row: data }
}

export async function PATCH(
    request: Request,
    { params }: { params: Promise<{ id: string; number: string; commentId: string }> },
) {
    const { id, commentId } = await params
    const ghId = Number(commentId)
    if (!Number.isInteger(ghId)) return jsonError("bad_request", "invalid comment id", 400)

    const { supabase, user, error } = await new ApiContext().requireProjectAccess(id)
    if (error) return error

    let body: string
    try {
        const j = (await request.json()) as { body?: string }
        body = (j.body ?? "").trim()
    } catch {
        return jsonError("bad_request", "invalid json body", 400)
    }
    if (!body) return jsonError("bad_request", "comment body is required", 400)

    const owned = await loadOwned(supabase, id, ghId, user.id)
    if ("error" in owned) return owned.error

    const ctx = await new CommentActions().resolve(supabase, user.id, id)
    if ("error" in ctx) return ctx.error

    let updated
    try {
        updated = await ctx.vcs.updateComment(ghId, body)
    } catch (e) {
        if (e instanceof VcsReauthError) return jsonError("github_reauth_required", "Reconnect GitHub to comment.", 401)
        return jsonError("github_error", (e as Error).message, 502)
    }

    await createServicePullRequestStore().upsertComment(id, {
        pr_number: owned.row.pr_number,
        source: "issue_comment",
        github_comment_id: ghId,
        body: updated.body ?? "",
        html_url: updated.url,
        gh_updated_at: updated.updatedAt,
    })
    return Response.json({ ok: true })
}

export async function DELETE(
    _: Request,
    { params }: { params: Promise<{ id: string; number: string; commentId: string }> },
) {
    const { id, commentId } = await params
    const ghId = Number(commentId)
    if (!Number.isInteger(ghId)) return jsonError("bad_request", "invalid comment id", 400)

    const { supabase, user, error } = await new ApiContext().requireProjectAccess(id)
    if (error) return error

    const owned = await loadOwned(supabase, id, ghId, user.id)
    if ("error" in owned) return owned.error

    const ctx = await new CommentActions().resolve(supabase, user.id, id)
    if ("error" in ctx) return ctx.error

    try {
        await ctx.vcs.deleteComment(ghId)
    } catch (e) {
        if (e instanceof VcsReauthError) return jsonError("github_reauth_required", "Reconnect GitHub to comment.", 401)
        return jsonError("github_error", (e as Error).message, 502)
    }

    await createServicePullRequestStore().deleteComment(id, "issue_comment", ghId)
    return Response.json({ ok: true })
}
