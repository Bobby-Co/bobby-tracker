import { ApiContext, jsonError } from "@/lib/server/http/api"
import { CommentActions, VcsReauthError, createServicePullRequestStore } from "@/modules/vcs"

// POST /api/projects/[id]/pulls/[number]/comments
//
// Posts a comment on the PR AS THE SIGNED-IN USER (their GitHub token), then
// mirrors it locally with provenance 'tracker' so it renders as editable/owned.
// The echoing webhook won't clobber it (webhook upserts omit provenance).
export async function POST(request: Request, { params }: { params: Promise<{ id: string; number: string }> }) {
    const { id, number } = await params
    const prNumber = Number(number)
    if (!Number.isInteger(prNumber)) return jsonError("bad_request", "invalid PR number", 400)

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

    // CommentActions is a vcs gate that resolves the user's VcsUserInstance; it
    // takes the request's DB handle (a deeper vcs-internal refactor keeps it here).
    const actions = await new CommentActions().resolve(ctx.client, user.id, id)
    if ("error" in actions) return actions.error

    let created
    try {
        created = await actions.vcs.createComment(prNumber, body)
    } catch (e) {
        if (e instanceof VcsReauthError) {
            return jsonError("github_reauth_required", "Reconnect GitHub to comment.", 401)
        }
        return jsonError("github_error", (e as Error).message, 502)
    }

    await createServicePullRequestStore().upsertComment(id, {
        pr_number: prNumber,
        source: "issue_comment",
        github_comment_id: created.id,
        provenance: "tracker",
        author_user_id: user.id,
        author_login: created.author?.login ?? actions.login ?? null,
        author_avatar_url: created.author?.avatarUrl ?? null,
        body: created.body ?? "",
        html_url: created.url,
        gh_created_at: created.createdAt,
        gh_updated_at: created.updatedAt,
    })

    return Response.json({ ok: true, github_comment_id: created.id })
}
