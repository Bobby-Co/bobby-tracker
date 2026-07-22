import { ApiContext, forbidden, jsonError, repoRead } from "@/lib/server/http/api"
import { Role } from "@/modules/access"

// POST /api/teams/[id]/groups/[gid]/projects — grant a team project to a
// people-group (admins). The composite FK rejects a project from another team.
export async function POST(request: Request, { params }: { params: Promise<{ id: string; gid: string }> }) {
    const { id, gid } = await params
    const { ctx, user, error } = await new ApiContext().requireUser()
    if (error) return error
    const role = await ctx.access.teamRole(id, user.id)
    if (!role) return jsonError("not_found", "team not found", 404)
    if (!Role.of(role).atLeast("admin")) return forbidden("only team admins can grant project access")

    let body: Record<string, unknown>
    try { body = await request.json() } catch { return jsonError("bad_request", "invalid JSON", 400) }
    const projectId = String(body?.project_id ?? "").trim()
    if (!projectId) return jsonError("bad_request", "project_id is required", 400)

    const { data: result, error: dbErr } = await repoRead(() => ctx.accessGroups.grantProject(gid, id, projectId))
    if (dbErr) return dbErr
    if (result === "fk_violation") return jsonError("bad_request", "that project doesn't belong to this team", 400)
    return new Response(null, { status: 204 })
}
