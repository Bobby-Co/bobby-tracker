// HTTP plumbing shared by the OAuth route handlers: CORS, cache policy, and the
// RFC 6749 §5.2 error envelope. Transport primitives, not a port implementation —
// so free functions rather than a class (modules/README allows exactly this).
//
// CORS IS WIDE OPEN AND THAT IS CORRECT HERE. These endpoints are the ones a
// browser-based MCP client (claude.ai) must reach cross-origin, and they carry no
// ambient authority: discovery is public metadata, and register/token/revoke are
// authenticated by material in the request BODY (client secret, PKCE verifier,
// refresh token), never by a cookie. Because nothing here trusts a cookie,
// `Access-Control-Allow-Origin: *` grants an attacker's page nothing it could not
// already do with a plain fetch from their own server — and `Allow-Credentials`
// is deliberately absent, so cookies are never attached to these cross-origin
// calls in the first place.
//
// NOTE the one endpoint NOT in this file: POST /api/oauth/authorize (the consent
// decision) IS cookie-authenticated, so it is same-origin only and carries no
// CORS headers at all.

import type { OAuthError } from "../domain/OAuthError"

const CORS: Record<string, string> = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, MCP-Protocol-Version",
    "Access-Control-Max-Age": "86400",
}

/** Public, cacheable discovery metadata. */
export function discoveryJson(body: unknown): Response {
    return Response.json(body, {
        headers: { ...CORS, "Cache-Control": "public, max-age=300" },
    })
}

/** A token/registration response. `no-store` is mandated by RFC 6749 §5.1 —
 *  these bodies contain credentials and must not sit in any cache. */
export function credentialJson(body: unknown, status = 200, extra?: Record<string, string>): Response {
    return Response.json(body, {
        status,
        headers: { ...CORS, "Cache-Control": "no-store", Pragma: "no-cache", ...extra },
    })
}

/** The `{error, error_description}` envelope with the status the protocol
 *  prescribes. `invalid_client` additionally carries WWW-Authenticate per
 *  RFC 6749 §5.2 when the caller tried to authenticate. */
export function oauthErrorJson(error: OAuthError, wwwAuthenticate = false): Response {
    const extra: Record<string, string> = {}
    if (wwwAuthenticate && error.code === "invalid_client") {
        extra["WWW-Authenticate"] = 'Basic realm="mcp-oauth", charset="UTF-8"'
    }
    return credentialJson(error.toJson(), error.status, extra)
}

/** Preflight. Returned from every OPTIONS handler in app/api/oauth and
 *  app/.well-known. */
export function corsPreflight(): Response {
    return new Response(null, { status: 204, headers: CORS })
}
