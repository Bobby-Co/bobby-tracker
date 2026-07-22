import { ApiContext, jsonError, repoRead } from "@/lib/server/http/api"

// Per-project toggle for the public-submissions integration.
// Disabling also removes the project from any sessions that cover it,
// so an off-state is meaningfully off (no surprise submissions can
// trickle in via still-active session memberships).

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { ctx, error } = await new ApiContext().requireProjectAccess(id)
    if (error) return error
    const data = await ctx.publicIntegration.findIntegration(id)
    return Response.json({
        integration: data ?? { project_id: id, enabled: false, created_at: null, updated_at: null },
    })
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { ctx, error } = await new ApiContext().requireProjectAccess(id)
    if (error) return error

    let body: Record<string, unknown>
    try { body = await request.json() } catch { return jsonError("bad_request", "invalid JSON", 400) }
    if (typeof body.enabled !== "boolean") return jsonError("bad_request", "enabled (boolean) required", 400)
    const enabled = body.enabled

    const { data, error: dbErr } = await repoRead(() => ctx.publicIntegration.setIntegration(id, enabled))
    if (dbErr) return dbErr

    if (!enabled) {
        // Drop the project from any sessions covering it. Submissions
        // through the link will then 400 because the project_id is no
        // longer in the session's coverage list.
        const { error: unlinkErr } = await repoRead(() => ctx.sessionsAdmin.removeProjectFromAllSessions(id))
        if (unlinkErr) return unlinkErr
    }

    return Response.json({ integration: data })
}
