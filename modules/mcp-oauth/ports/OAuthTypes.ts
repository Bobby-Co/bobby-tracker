// The vendor-neutral DTOs and lifetimes the mcp-oauth ports speak. Pure type
// declarations plus a handful of constants — no runtime behaviour, no SDK.

/** Access-token lifetime. Short, because a refresh token exists to renew it and
 *  a compromised access token can't be individually recalled by the client. */
export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60 // 1 hour

/** Refresh-token lifetime. Long-lived so an MCP client stays connected without
 *  re-prompting; rotation on every use is what keeps that safe. */
export const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 60 // 60 days

/** Authorization-code lifetime — the RFC 6749 §4.1.2 recommended maximum.
 *
 *  This was 60s on the reasoning that "a code is redeemed within a second in
 *  practice". That holds for a browser-only flow, but NOT for the one real
 *  clients actually use: Claude approves in the browser, claude.ai's callback
 *  hands the code back to the DESKTOP APP, and the desktop app performs the
 *  exchange. That hop involves a process wake-up and a deep link, and it is
 *  easily slower than a minute — after which the exchange fails and the user is
 *  told only "Couldn't connect".
 *
 *  Ten minutes is safe here because the code's protection was never its
 *  lifetime: it is single-use (consumed atomically), PKCE-bound so an
 *  interceptor without the verifier cannot redeem it, pinned to the client and
 *  redirect_uri, and a replay revokes every token descended from it. */
export const AUTHORIZATION_CODE_TTL_SECONDS = 60 * 10

/** The claims a resolved access token yields. THIS TYPE IS A PUBLISHED CONTRACT —
 *  the MCP server imports it from the module barrel. */
export type McpTokenClaims = {
    userId: string
    clientId: string
    scopes: string[]
    expiresAt: string
}

// ─── clients ────────────────────────────────────────────────────────────────

export type TokenEndpointAuthMethod = "none" | "client_secret_basic" | "client_secret_post"

export interface OAuthClientRecord {
    clientId: string
    /** SHA-256(base64url) of the secret; null for a public client. */
    clientSecretHash: string | null
    clientName: string
    redirectUris: string[]
    grantTypes: string[]
    tokenEndpointAuthMethod: TokenEndpointAuthMethod
    clientUri: string | null
    createdAt: string
}

export interface NewOAuthClient {
    clientId: string
    clientSecretHash: string | null
    clientName: string
    redirectUris: string[]
    grantTypes: string[]
    tokenEndpointAuthMethod: TokenEndpointAuthMethod
    clientUri: string | null
}

// ─── authorization codes ────────────────────────────────────────────────────

export interface NewOAuthCode {
    codeHash: string
    clientId: string
    userId: string
    redirectUri: string
    codeChallenge: string
    scope: string
    resource: string | null
    expiresAt: string
}

export interface OAuthCodeRecord {
    codeHash: string
    clientId: string
    userId: string
    redirectUri: string
    codeChallenge: string
    codeChallengeMethod: string
    scope: string
    resource: string | null
    expiresAt: string
    consumedAt: string | null
}

// ─── tokens ─────────────────────────────────────────────────────────────────

export interface NewOAuthToken {
    tokenHash: string
    refreshHash: string | null
    clientId: string
    userId: string
    scope: string
    expiresAt: string
    refreshExpiresAt: string | null
    /** Provenance — which authorization code this pair descends from, so a
     *  detected code replay can revoke everything that code produced. */
    codeHash: string | null
}

export interface OAuthTokenRecord {
    id: string
    tokenHash: string
    refreshHash: string | null
    clientId: string
    userId: string
    scope: string
    expiresAt: string
    refreshExpiresAt: string | null
    revokedAt: string | null
    lastUsedAt: string | null
    codeHash: string | null
}

/** One live authorization the user has granted, as the management UI shows it.
 *  Carries NO hash and no token material — this crosses into the browser. */
export interface OAuthConnection {
    id: string
    clientId: string
    clientName: string
    scope: string
    expiresAt: string
    lastUsedAt: string | null
    createdAt: string
}

/** What the token endpoint hands back (RFC 6749 §5.1, camelCase until the edge). */
export interface IssuedTokens {
    accessToken: string
    refreshToken: string
    tokenType: "Bearer"
    expiresIn: number
    scope: string
}
