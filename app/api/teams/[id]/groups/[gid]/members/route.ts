import { forbidden, jsonError, requireUser } from "@/lib/server/http/api"
import { getTeamRole, roleAtLeast } from "@/lib/server/auth/team-access"

// POST /api/teams/[id]/groups/[gid]/members — add a team member to a people-group
// (admins). The double composite FK rejects a user who isn't on the team.
export async function POST(request: Request, { params }: { params: Promise<{ id: string; gid: string }> }) {
    const { id, gid } = await params
    const { supabase, user, error } = await requireUser()
    if (error) return error
    const role = await getTeamRole(supabase, id, user.id)
    if (!role) return jsonError("not_found", "team not found", 404)
    if (!roleAtLeast(role, "admin")) return forbidden("only team admins can manage group members")

    let body: Record<string, unknown>
    try { body = await request.json() } catch { return jsonError("bad_request", "invalid JSON", 400) }
    const targetId = String(body?.user_id ?? "").trim()
    if (!targetId) return jsonError("bad_request", "user_id is required", 400)

    const { error: dbErr } = await supabase
        .from("access_group_members")
        .upsert({ group_id: gid, team_id: id, user_id: targetId }, { onConflict: "group_id,user_id" })
    if (dbErr) {
        // 23503 = FK violation: the user isn't a member of this team.
        if (dbErr.code === "23503") return jsonError("bad_request", "that user isn't a member of this team", 400)
        return jsonError("db_error", dbErr.message, 500)
    }
    return new Response(null, { status: 204 })
}
