import { forbidden, jsonError, requireUser } from "@/lib/platform/http/api"
import { getTeamRole, roleAtLeast } from "@/lib/auth/team-access"

// DELETE /api/teams/[id]/groups/[gid]/members/[userId] — remove a person from a
// people-group (admins).
export async function DELETE(_: Request, { params }: { params: Promise<{ id: string; gid: string; userId: string }> }) {
    const { id, gid, userId } = await params
    const { supabase, user, error } = await requireUser()
    if (error) return error
    const role = await getTeamRole(supabase, id, user.id)
    if (!role) return jsonError("not_found", "team not found", 404)
    if (!roleAtLeast(role, "admin")) return forbidden("only team admins can manage group members")

    const { error: dbErr } = await supabase
        .from("access_group_members")
        .delete()
        .eq("group_id", gid)
        .eq("user_id", userId)
    if (dbErr) return jsonError("db_error", dbErr.message, 500)
    return new Response(null, { status: 204 })
}
