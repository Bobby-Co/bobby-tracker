import { ApiContext, forbidden, jsonError, repoRead } from "@/lib/server/http/api"
import { Role } from "@/modules/access"

// DELETE /api/teams/[id]/invites/[token] — revoke a pending invite (admins).
export async function DELETE(_: Request, { params }: { params: Promise<{ id: string; token: string }> }) {
    const { id, token } = await params
    const { ctx, user, error } = await new ApiContext().requireUser()
    if (error) return error
    const role = await ctx.access.teamRole(id, user.id)
    if (!role) return jsonError("not_found", "team not found", 404)
    if (!Role.of(role).atLeast("admin")) return forbidden("only team admins can revoke invites")

    const { error: dbErr } = await repoRead(() => ctx.teamInvites.revoke(id, token))
    if (dbErr) return dbErr
    return new Response(null, { status: 204 })
}
