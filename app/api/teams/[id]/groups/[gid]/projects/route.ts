import { forbidden, jsonError, requireUser } from "@/lib/api"
import { getTeamRole, roleAtLeast } from "@/lib/auth/team-access"

// POST /api/teams/[id]/groups/[gid]/projects — grant a team project to a
// people-group (admins). The composite FK rejects a project from another team.
export async function POST(request: Request, { params }: { params: Promise<{ id: string; gid: string }> }) {
    const { id, gid } = await params
    const { supabase, user, error } = await requireUser()
    if (error) return error
    const role = await getTeamRole(supabase, id, user.id)
    if (!role) return jsonError("not_found", "team not found", 404)
    if (!roleAtLeast(role, "admin")) return forbidden("only team admins can grant project access")

    let body: Record<string, unknown>
    try { body = await request.json() } catch { return jsonError("bad_request", "invalid JSON", 400) }
    const projectId = String(body?.project_id ?? "").trim()
    if (!projectId) return jsonError("bad_request", "project_id is required", 400)

    const { error: dbErr } = await supabase
        .from("access_group_projects")
        .upsert({ group_id: gid, team_id: id, project_id: projectId }, { onConflict: "group_id,project_id" })
    if (dbErr) {
        if (dbErr.code === "23503") return jsonError("bad_request", "that project doesn't belong to this team", 400)
        return jsonError("db_error", dbErr.message, 500)
    }
    return new Response(null, { status: 204 })
}
