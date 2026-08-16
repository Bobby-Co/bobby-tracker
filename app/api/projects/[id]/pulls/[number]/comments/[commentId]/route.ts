import { ApiContext, jsonError } from "@/lib/server/http/api"
import { CommentActions, VcsReauthError, createServicePullRequestStore } from "@/modules/vcs"
import type { RequestContext } from "@/lib/server/http/api"
import type { CommentOwnership } from "@/modules/vcs"
import { dataClientForProject } from "@/lib/server/regional"

// Edit / delete a PR comment the user authored from here. `commentId` is the
// GitHub comment id. Only tracker-provenance comments owned by the caller are
// writable; GitHub-origin comments are read-only mirrors (edit on GitHub).

async function loadOwned(
    ctx: RequestContext,
    projectId: string,
    commentId: number,
    userId: string,
): Promise<{ row: CommentOwnership } | { error: Response }> {
    const data = await ctx.pullRequests.findCommentOwnership(projectId, commentId)
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

    const { ctx, user, error } = await new ApiContext().requireProjectAccess(id)
    if (error) return error

    let body: string
    try {
        const j = (await request.json()) as { body?: string }
        body = (j.body ?? "").trim()
    } catch {
        return jsonError("bad_request", "invalid json body", 400)
    }
    if (!body) return jsonError("bad_request", "comment body is required", 400)

    const owned = await loadOwned(ctx, id, ghId, user.id)
    if ("error" in owned) return owned.error

    const actions = await new CommentActions().resolve(ctx.client, user.id, id)
    if ("error" in actions) return actions.error

    let updated
    try {
        updated = await actions.vcs.updateComment(owned.row.pr_number, ghId, body)
    } catch (e) {
        if (e instanceof VcsReauthError) return jsonError("github_reauth_required", "Reconnect GitHub to comment.", 401)
        return jsonError("github_error", (e as Error).message, 502)
    }

    await createServicePullRequestStore(await dataClientForProject(id)).upsertComment(id, {
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

    const { ctx, user, error } = await new ApiContext().requireProjectAccess(id)
    if (error) return error

    const owned = await loadOwned(ctx, id, ghId, user.id)
    if ("error" in owned) return owned.error

    const actions = await new CommentActions().resolve(ctx.client, user.id, id)
    if ("error" in actions) return actions.error

    try {
        await actions.vcs.deleteComment(owned.row.pr_number, ghId)
    } catch (e) {
        if (e instanceof VcsReauthError) return jsonError("github_reauth_required", "Reconnect GitHub to comment.", 401)
        return jsonError("github_error", (e as Error).message, 502)
    }

    await createServicePullRequestStore(await dataClientForProject(id)).deleteComment(id, "issue_comment", ghId)
    return Response.json({ ok: true })
}
