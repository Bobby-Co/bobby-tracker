import { jsonError, requireProjectAccess } from "@/lib/platform/http/api"
import { resolveCommentContext, VcsReauthError, createServicePullRequestStore } from "@/modules/vcs"

// POST /api/projects/[id]/pulls/[number]/comments
//
// Posts a comment on the PR AS THE SIGNED-IN USER (their GitHub token), then
// mirrors it locally with provenance 'tracker' so it renders as editable/owned.
// The echoing webhook won't clobber it (webhook upserts omit provenance).
export async function POST(request: Request, { params }: { params: Promise<{ id: string; number: string }> }) {
    const { id, number } = await params
    const prNumber = Number(number)
    if (!Number.isInteger(prNumber)) return jsonError("bad_request", "invalid PR number", 400)

    const { supabase, user, error } = await requireProjectAccess(id)
    if (error) return error

    let body: string
    try {
        const j = (await request.json()) as { body?: string }
        body = (j.body ?? "").trim()
    } catch {
        return jsonError("bad_request", "invalid json body", 400)
    }
    if (!body) return jsonError("bad_request", "comment body is required", 400)

    const ctx = await resolveCommentContext(supabase, user.id, id)
    if ("error" in ctx) return ctx.error

    let created
    try {
        created = await ctx.vcs.createComment(prNumber, body)
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
        author_login: created.author?.login ?? ctx.login ?? null,
        author_avatar_url: created.author?.avatarUrl ?? null,
        body: created.body ?? "",
        html_url: created.url,
        gh_created_at: created.createdAt,
        gh_updated_at: created.updatedAt,
    })

    return Response.json({ ok: true, github_comment_id: created.id })
}
