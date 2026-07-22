import { ApiContext, forbidden, jsonError } from "@/lib/server/http/api"
import { getAccessService, Role } from "@/modules/access"

// DELETE /api/teams/[id]/invites/[token] — revoke a pending invite (admins).
export async function DELETE(_: Request, { params }: { params: Promise<{ id: string; token: string }> }) {
    const { id, token } = await params
    const { supabase, user, error } = await new ApiContext().requireUser()
    if (error) return error
    const role = await getAccessService(supabase).teamRole(id, user.id)
    if (!role) return jsonError("not_found", "team not found", 404)
    if (!Role.of(role).atLeast("admin")) return forbidden("only team admins can revoke invites")

    const { error: dbErr } = await supabase
        .from("team_invites")
        .delete()
        .eq("team_id", id)
        .eq("token", token)
    if (dbErr) return jsonError("db_error", dbErr.message, 500)
    return new Response(null, { status: 204 })
}
