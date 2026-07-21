import { jsonError, requireProjectAccess } from "@/lib/platform/http/api"
import { resolveCommentContext, VcsReauthError } from "@/modules/vcs"
import { createServiceIssueSyncStore } from "@/modules/issues"

// POST /api/projects/[id]/issues/[issueId]/comments
//
// Posts a comment on the linked GitHub issue AS THE SIGNED-IN USER, then mirrors
// it locally with provenance 'tracker'. Only works for issues that exist on
// GitHub (have a github_issue_number) — a tracker-only issue has no thread yet.
export async function POST(request: Request, { params }: { params: Promise<{ id: string; issueId: string }> }) {
    const { id, issueId } = await params

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

    // RLS restricts this read to the caller's own issue.
    const { data: issue } = await supabase
        .from("issues")
        .select("github_issue_number")
        .eq("id", issueId)
        .eq("project_id", id)
        .maybeSingle<{ github_issue_number: number | null }>()
    if (!issue) return jsonError("not_found", "issue not found", 404)
    if (!issue.github_issue_number) {
        return jsonError("not_on_github", "this issue isn't on GitHub yet — sync it first", 400)
    }

    const ctx = await resolveCommentContext(supabase, user.id, id)
    if ("error" in ctx) return ctx.error

    let created
    try {
        created = await ctx.vcs.createComment(issue.github_issue_number, body)
    } catch (e) {
        if (e instanceof VcsReauthError) return jsonError("github_reauth_required", "Reconnect GitHub to comment.", 401)
        return jsonError("github_error", (e as Error).message, 502)
    }

    await createServiceIssueSyncStore().upsertComment(id, {
        issue_number: issue.github_issue_number,
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
