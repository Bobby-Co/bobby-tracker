import { forbidden, jsonError, requireUser } from "@/lib/platform/http/api"
import { getTeamRole, roleAtLeast } from "@/lib/auth/team-access"

// DELETE /api/teams/[id]/invites/[token] — revoke a pending invite (admins).
export async function DELETE(_: Request, { params }: { params: Promise<{ id: string; token: string }> }) {
    const { id, token } = await params
    const { supabase, user, error } = await requireUser()
    if (error) return error
    const role = await getTeamRole(supabase, id, user.id)
    if (!role) return jsonError("not_found", "team not found", 404)
    if (!roleAtLeast(role, "admin")) return forbidden("only team admins can revoke invites")

    const { error: dbErr } = await supabase
        .from("team_invites")
        .delete()
        .eq("team_id", id)
        .eq("token", token)
    if (dbErr) return jsonError("db_error", dbErr.message, 500)
    return new Response(null, { status: 204 })
}
