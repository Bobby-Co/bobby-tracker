// DELETE /api/mcp/connections/[id] — revoke one authorization.
//
// Takes effect on the assistant's very next call: /api/mcp resolves the opaque
// bearer token against this row every request, so a revoked token stops working
// immediately rather than at expiry.
//
// Ownership is enforced INSIDE the statement (`id = … and user_id = …`), not by a
// preceding read, so there is no window between checking and writing. Another
// user's id simply matches no row and comes back 404.

import { ApiContext, jsonError } from "@/lib/server/http/api"
import { getOAuthTokenRepository } from "@/modules/mcp-oauth"

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { user, error } = await new ApiContext().requireUser()
    if (error) return error

    let revoked: boolean
    try {
        revoked = await getOAuthTokenRepository().revokeForUser(id, user.id)
    } catch {
        return jsonError("revoke_failed", "could not revoke this connection", 500)
    }

    // false = not this user's token, already revoked, or absent. All three are
    // "there is nothing here to revoke" — and we don't distinguish, so this can't
    // be used to probe for other users' token ids.
    if (!revoked) return jsonError("not_found", "connection not found", 404)
    return Response.json({ revoked: true })
}
