import { ApiContext, forbidden, jsonError, repoRead } from "@/lib/server/http/api"
import { Role } from "@/modules/access"

// POST /api/teams/[id]/groups/[gid]/members — add a team member to a people-group
// (admins). The double composite FK rejects a user who isn't on the team.
export async function POST(request: Request, { params }: { params: Promise<{ id: string; gid: string }> }) {
    const { id, gid } = await params
    const { ctx, user, error } = await new ApiContext().requireUser()
    if (error) return error
    const role = await ctx.access.teamRole(id, user.id)
    if (!role) return jsonError("not_found", "team not found", 404)
    if (!Role.of(role).atLeast("admin")) return forbidden("only team admins can manage group members")

    let body: Record<string, unknown>
    try { body = await request.json() } catch { return jsonError("bad_request", "invalid JSON", 400) }
    const targetId = String(body?.user_id ?? "").trim()
    if (!targetId) return jsonError("bad_request", "user_id is required", 400)

    const { data: result, error: dbErr } = await repoRead(() => ctx.accessGroups.addMember(gid, id, targetId))
    if (dbErr) return dbErr
    // 23503 = FK violation: the user isn't a member of this team.
    if (result === "fk_violation") return jsonError("bad_request", "that user isn't a member of this team", 400)
    return new Response(null, { status: 204 })
}
