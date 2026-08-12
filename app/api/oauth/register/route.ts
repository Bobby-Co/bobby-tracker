import { RateLimiter } from "@/lib/server/RateLimiter"
import {
    MCP_SCOPE,
    OAuthError,
    corsPreflight,
    credentialJson,
    getOAuthClientService,
    oauthErrorJson,
} from "@/modules/mcp-oauth"

// POST /api/oauth/register — RFC 7591 Dynamic Client Registration.
//
// PUBLIC BY DESIGN. There is no initial access token: that is what lets Claude
// Code discover this server and register itself with no manual setup, and it is
// what the MCP authorization spec assumes. Registering buys an attacker nothing
// on its own — a registered client can reach exactly zero data until a signed-in
// human approves it on the consent screen, and even then it acts only as that one
// user, with one read-only scope.
//
// What registration COULD be abused for is filling the table, so the surface is
// bounded on three axes: per-IP rate limiting here, a body-size cap here, and
// redirect-URI count/length/scheme limits in the domain policy (RedirectUris).

export async function POST(request: Request) {
    const rl = new RateLimiter()
    const limited = await rl.enforce("PUBLIC_RL", rl.clientKey(request, "oauth-register"))
    if (limited) return limited

    // Reject an oversized body before parsing it, so a hostile client can't make
    // us buffer megabytes just to find out the metadata is invalid.
    const declaredLength = Number(request.headers.get("content-length") ?? "0")
    if (Number.isFinite(declaredLength) && declaredLength > 16_384) {
        return oauthErrorJson(OAuthError.invalidClientMetadata("registration body is too large"))
    }

    let body: Record<string, unknown>
    try {
        const parsed: unknown = await request.json()
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object")
        body = parsed as Record<string, unknown>
    } catch {
        return oauthErrorJson(OAuthError.invalidClientMetadata("request body must be a JSON object"))
    }

    const result = await getOAuthClientService().register(body)
    if (!result.ok) return oauthErrorJson(result.error)

    const { record, clientSecret } = result.value

    // RFC 7591 §3.2.1: 201 with the registered metadata echoed back. The secret
    // (confidential clients only) appears HERE AND NOWHERE ELSE — only its hash is
    // stored, so it can never be re-read.
    return credentialJson(
        {
            client_id: record.clientId,
            client_id_issued_at: Math.floor(Date.parse(record.createdAt) / 1000),
            client_name: record.clientName,
            redirect_uris: record.redirectUris,
            grant_types: record.grantTypes,
            response_types: ["code"],
            token_endpoint_auth_method: record.tokenEndpointAuthMethod,
            scope: MCP_SCOPE,
            ...(record.clientUri ? { client_uri: record.clientUri } : {}),
            ...(clientSecret
                ? {
                      client_secret: clientSecret,
                      // 0 = never expires (RFC 7591 §3.2.1).
                      client_secret_expires_at: 0,
                  }
                : {}),
        },
        201,
    )
}

export async function OPTIONS() {
    return corsPreflight()
}
