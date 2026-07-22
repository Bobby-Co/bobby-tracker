import { ApiContext, forbidden, jsonError } from "@/lib/server/http/api"
import { getAccessService, Role } from "@/modules/access"
import { TEAM_ROLES, type TeamRole } from "@/lib/shared/types"

// PATCH /api/teams/[id]/members/[userId] — change a member's role (admins). The
// DB last-owner trigger blocks demoting the final owner.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; userId: string }> }) {
    const { id, userId } = await params
    const { supabase, user, error } = await new ApiContext().requireUser()
    if (error) return error
    const role = await getAccessService(supabase).teamRole(id, user.id)
    if (!role) return jsonError("not_found", "team not found", 404)
    if (!Role.of(role).atLeast("admin")) return forbidden("only team admins can change roles")

    let body: Record<string, unknown>
    try { body = await request.json() } catch { return jsonError("bad_request", "invalid JSON", 400) }
    const next = String(body?.role ?? "") as TeamRole
    if (!TEAM_ROLES.includes(next)) return jsonError("bad_request", "invalid role", 400)
    // Only an owner may promote another member to owner.
    if (next === "owner" && role !== "owner") return forbidden("only an owner can promote to owner")

    const { error: dbErr } = await supabase
        .from("team_members")
        .update({ role: next })
        .eq("team_id", id)
        .eq("user_id", userId)
    if (dbErr) {
        // 23514 = last-owner trigger raised check_violation
        if (dbErr.code === "23514") return jsonError("conflict", dbErr.message, 409)
        return jsonError("db_error", dbErr.message, 500)
    }
    return new Response(null, { status: 204 })
}

// DELETE /api/teams/[id]/members/[userId] — remove a member (admins), or a member
// removing themselves (leave). The last-owner trigger protects the final owner.
export async function DELETE(_: Request, { params }: { params: Promise<{ id: string; userId: string }> }) {
    const { id, userId } = await params
    const { supabase, user, error } = await new ApiContext().requireUser()
    if (error) return error
    const role = await getAccessService(supabase).teamRole(id, user.id)
    if (!role) return jsonError("not_found", "team not found", 404)
    const isSelf = userId === user.id
    if (!isSelf && !Role.of(role).atLeast("admin")) return forbidden("only team admins can remove members")

    const { error: dbErr } = await supabase
        .from("team_members")
        .delete()
        .eq("team_id", id)
        .eq("user_id", userId)
    if (dbErr) {
        if (dbErr.code === "23514") return jsonError("conflict", "the last owner can't leave — transfer ownership first", 409)
        return jsonError("db_error", dbErr.message, 500)
    }
    return new Response(null, { status: 204 })
}
