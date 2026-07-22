import { ApiContext, jsonError, repoRead } from "@/lib/server/http/api"

// POST — add a project to a session. RLS on public_session_projects
// enforces that the project belongs to the same owner, so we don't
// re-check ownership here.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { ctx, error } = await new ApiContext().requireSessionAccess(id, { write: true })
    if (error) return error

    let body: Record<string, unknown>
    try { body = await request.json() } catch { return jsonError("bad_request", "invalid JSON", 400) }

    const project_id = typeof body.project_id === "string" ? body.project_id.trim() : ""
    if (!project_id) return jsonError("bad_request", "project_id required", 400)

    const { data: result, error: dbErr } = await repoRead(() => ctx.sessionsAdmin.addProject(id, project_id))
    if (dbErr) return dbErr
    if (result === "duplicate") return jsonError("conflict", "project already in session", 409)
    if (result === "integration_disabled") {
        return jsonError(
            "integration_disabled",
            "Enable the public submissions integration on this project before adding it to a session.",
            409,
        )
    }
    return Response.json({ ok: true })
}
