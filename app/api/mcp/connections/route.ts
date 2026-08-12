// GET /api/mcp/connections — the AI assistants currently authorized to query this
// user's knowledge bases.
//
// Browser-session route (contrast /api/mcp itself, which is bearer-authenticated):
// it backs the management list in Settings → AI Assistant. The user id comes from
// the session and is passed explicitly to the repository, which pins it in the
// WHERE clause — a caller can only ever see their own grants.

import { ApiContext, jsonError } from "@/lib/server/http/api"
import { getOAuthTokenRepository } from "@/modules/mcp-oauth"

export async function GET() {
    const { user, error } = await new ApiContext().requireUser()
    if (error) return error

    try {
        const connections = await getOAuthTokenRepository().listConnectionsForUser(user.id)
        return Response.json({ connections })
    } catch {
        // Most likely cause is migration 0061 not yet applied. Report it rather
        // than pretending the user has no connections.
        return jsonError("connections_unavailable", "could not load connected assistants", 500)
    }
}
