import { ApiContext, forbidden, jsonError, repoRead } from "@/lib/server/http/api"
import { Role } from "@/modules/access"

// DELETE /api/teams/[id]/groups/[gid]/projects/[projectId] — revoke a project
// grant from a people-group (admins).
export async function DELETE(_: Request, { params }: { params: Promise<{ id: string; gid: string; projectId: string }> }) {
    const { id, gid, projectId } = await params
    const { ctx, user, error } = await new ApiContext().requireUser()
    if (error) return error
    const role = await ctx.access.teamRole(id, user.id)
    if (!role) return jsonError("not_found", "team not found", 404)
    if (!Role.of(role).atLeast("admin")) return forbidden("only team admins can revoke project access")

    const { error: dbErr } = await repoRead(() => ctx.accessGroups.revokeProject(gid, projectId))
    if (dbErr) return dbErr
    return new Response(null, { status: 204 })
}
