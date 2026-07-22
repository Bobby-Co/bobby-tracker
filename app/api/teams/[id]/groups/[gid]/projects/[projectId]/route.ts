import { forbidden, jsonError, requireUser } from "@/lib/server/http/api"
import { getAccessService, Role } from "@/modules/access"

// DELETE /api/teams/[id]/groups/[gid]/projects/[projectId] — revoke a project
// grant from a people-group (admins).
export async function DELETE(_: Request, { params }: { params: Promise<{ id: string; gid: string; projectId: string }> }) {
    const { id, gid, projectId } = await params
    const { supabase, user, error } = await requireUser()
    if (error) return error
    const role = await getAccessService(supabase).teamRole(id, user.id)
    if (!role) return jsonError("not_found", "team not found", 404)
    if (!Role.of(role).atLeast("admin")) return forbidden("only team admins can revoke project access")

    const { error: dbErr } = await supabase
        .from("access_group_projects")
        .delete()
        .eq("group_id", gid)
        .eq("project_id", projectId)
    if (dbErr) return jsonError("db_error", dbErr.message, 500)
    return new Response(null, { status: 204 })
}
