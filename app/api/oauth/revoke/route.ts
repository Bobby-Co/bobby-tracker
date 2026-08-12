import { RateLimiter } from "@/lib/server/RateLimiter"
import { corsPreflight, credentialJson, getOAuthTokenService } from "@/modules/mcp-oauth"

// POST /api/oauth/revoke — RFC 7009 Token Revocation.
//
// ALWAYS 200. Not laziness: §2.2 requires it. An unknown, already-revoked, or
// someone-else's token must be indistinguishable from a successful revocation,
// because any difference turns this endpoint into an oracle for "is this token
// live?" — which is precisely what an attacker holding a stolen token wants to
// know. The only thing a caller learns is that we accepted the request.
//
// Revoking an ACCESS token kills just that token; revoking a REFRESH token kills
// the row it belongs to, which is its access token too. A client that wants to
// disconnect entirely revokes its refresh token.

export async function POST(request: Request) {
    const rl = new RateLimiter()
    const limited = await rl.enforce("PUBLIC_RL", rl.clientKey(request, "oauth-revoke"))
    if (limited) return limited

    let token: string | null = null
    let clientId: string | null = null
    try {
        const contentType = request.headers.get("content-type") ?? ""
        if (contentType.includes("application/x-www-form-urlencoded")) {
            const form = new URLSearchParams(await request.text())
            token = form.get("token")
            clientId = form.get("client_id")
        }
    } catch {
        // Fall through — an unparseable body still gets a 200, same as above.
    }

    // `token_type_hint` is deliberately ignored: the service looks the value up as
    // both an access and a refresh token, so a wrong or absent hint costs nothing
    // and a malicious hint gains nothing.
    await getOAuthTokenService().revoke(token, clientId)

    return credentialJson({}, 200)
}

export async function OPTIONS() {
    return corsPreflight()
}
