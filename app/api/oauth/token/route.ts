import { RateLimiter } from "@/lib/server/RateLimiter"
import {
    OAuthError,
    corsPreflight,
    credentialJson,
    getOAuthTokenService,
    oauthErrorJson,
} from "@/modules/mcp-oauth"

// POST /api/oauth/token — RFC 6749 §3.2, application/x-www-form-urlencoded only.
//
//   grant_type=authorization_code   redeem a consented code (PKCE verified,
//                                   single-use, redirect_uri + client bound)
//   grant_type=refresh_token        rotate: the presented refresh token dies and
//                                   a fresh pair is issued
//
// This route is a THIN CONTROLLER on purpose: parse the form, pull client
// credentials out of either Basic auth or the body, delegate, map the resulting
// OAuthError to its status. Every grant rule, replay defence and rotation
// decision lives in OAuthTokenService, where it can be reasoned about in one
// place instead of being smeared across a handler.
//
// Rate-limited because it is unauthenticated in the "no session" sense: a caller
// who guesses a code or a refresh token gets in, so guessing must be expensive.

export async function POST(request: Request) {
    const rl = new RateLimiter()
    const limited = await rl.enforce("PUBLIC_RL", rl.clientKey(request, "oauth-token"))
    if (limited) return limited

    const contentType = request.headers.get("content-type") ?? ""
    if (!contentType.includes("application/x-www-form-urlencoded")) {
        return oauthErrorJson(
            OAuthError.invalidRequest("content-type must be application/x-www-form-urlencoded"),
        )
    }

    let form: URLSearchParams
    try {
        form = new URLSearchParams(await request.text())
    } catch {
        return oauthErrorJson(OAuthError.invalidRequest("could not parse the request body"))
    }

    const service = getOAuthTokenService()
    const credentials = readClientCredentials(request, form)
    // A malformed Authorization header is a client-authentication failure, not a
    // bad grant — say so with the right code and status.
    if (!credentials.ok) return oauthErrorJson(credentials.error, true)

    const grantType = form.get("grant_type")
    const usedBasicAuth = credentials.usedBasicAuth

    if (grantType === "authorization_code") {
        const result = await service.exchangeCode({
            clientId: credentials.clientId,
            clientSecret: credentials.clientSecret,
            code: form.get("code"),
            redirectUri: form.get("redirect_uri"),
            codeVerifier: form.get("code_verifier"),
            resource: form.get("resource"),
        })
        return result.ok ? tokenResponse(result.value) : oauthErrorJson(result.error, usedBasicAuth)
    }

    if (grantType === "refresh_token") {
        const result = await service.refresh({
            clientId: credentials.clientId,
            clientSecret: credentials.clientSecret,
            refreshToken: form.get("refresh_token"),
            scope: form.get("scope"),
        })
        return result.ok ? tokenResponse(result.value) : oauthErrorJson(result.error, usedBasicAuth)
    }

    if (!grantType) return oauthErrorJson(OAuthError.invalidRequest("grant_type is required"))
    return oauthErrorJson(
        OAuthError.unsupportedGrantType(`grant_type "${grantType}" is not supported`),
    )
}

export async function OPTIONS() {
    return corsPreflight()
}

/** RFC 6749 §5.1 success body. `no-store` comes from credentialJson — mandatory,
 *  since this body IS the credential. */
function tokenResponse(issued: {
    accessToken: string
    refreshToken: string
    tokenType: "Bearer"
    expiresIn: number
    scope: string
}): Response {
    return credentialJson({
        access_token: issued.accessToken,
        token_type: issued.tokenType,
        expires_in: issued.expiresIn,
        refresh_token: issued.refreshToken,
        scope: issued.scope,
    })
}

type Credentials =
    | { ok: true; clientId: string | null; clientSecret: string | null; usedBasicAuth: boolean }
    | { ok: false; error: OAuthError }

/** Client credentials may arrive two ways (RFC 6749 §2.3.1): HTTP Basic, or
 *  client_id/client_secret in the form body. Public clients send only client_id.
 *  Presenting BOTH is rejected — an ambiguous identity is a request we should not
 *  guess at. */
function readClientCredentials(request: Request, form: URLSearchParams): Credentials {
    const bodyId = form.get("client_id")
    const bodySecret = form.get("client_secret")
    const header = request.headers.get("authorization") ?? ""

    if (!header.toLowerCase().startsWith("basic ")) {
        return { ok: true, clientId: bodyId, clientSecret: bodySecret, usedBasicAuth: false }
    }

    let decoded: string
    try {
        decoded = atob(header.slice("basic ".length).trim())
    } catch {
        return { ok: false, error: OAuthError.invalidClient("malformed Basic authorization header") }
    }
    const separator = decoded.indexOf(":")
    if (separator < 0) {
        return { ok: false, error: OAuthError.invalidClient("malformed Basic authorization header") }
    }
    // RFC 6749 §2.3.1 form-urlencodes each half before base64.
    const headerId = safeDecode(decoded.slice(0, separator))
    const headerSecret = safeDecode(decoded.slice(separator + 1))

    if (bodyId && bodyId !== headerId) {
        return { ok: false, error: OAuthError.invalidClient("conflicting client_id in header and body") }
    }
    return { ok: true, clientId: headerId, clientSecret: headerSecret, usedBasicAuth: true }
}

function safeDecode(value: string): string {
    try {
        return decodeURIComponent(value.replace(/\+/g, " "))
    } catch {
        return value
    }
}
