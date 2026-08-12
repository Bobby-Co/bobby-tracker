// The token-endpoint use cases: authorization-code exchange, refresh rotation,
// revocation (RFC 7009), and the bearer-token resolution the MCP resource server
// calls on every request.
//
// THREE ABUSE DEFENCES LIVE HERE, and they are the reason this file is not just
// four CRUD calls:
//
//  1. CODE REPLAY. `consume()` is an atomic "stamp consumed_at if still null,
//     tell me if I won". A second exchange of the same code therefore always
//     loses, and losing does more than fail: it revokes every token that code
//     already produced (RFC 6749 §4.1.2), on the assumption that if two parties
//     hold the code, one of them is an attacker and we cannot tell which.
//
//  2. REFRESH REUSE. Refresh tokens ROTATE — each use revokes the presented one
//     and issues a fresh pair. Presenting an already-rotated refresh token is
//     proof that someone kept a copy, so it revokes the client's whole token
//     family for that user (RFC 6819 §5.2.2.3) rather than just failing.
//
//  3. NO ORACLES. Unknown / expired / revoked / wrong-client / bad-PKCE all
//     collapse to one `invalid_grant`. Distinguishing them would let a caller
//     enumerate what exists. The real reason IS recorded, but only in the server
//     log (see denyCode) — an operator debugging "Couldn't connect" should not
//     have to guess which of six rules fired, and the client still learns
//     nothing.

import { ok, err, type Result } from "@/lib/shared/kernel"
import { MCP_SCOPE } from "../domain/AuthorizationRequest"
import { OAuthError } from "../domain/OAuthError"
import { OpaqueSecret } from "../domain/OpaqueSecret"
import { Pkce } from "../domain/Pkce"
import type { OAuthClientRepository } from "../ports/OAuthClientRepository"
import type { OAuthCodeRepository } from "../ports/OAuthCodeRepository"
import type { OAuthTokenRepository } from "../ports/OAuthTokenRepository"
import {
    ACCESS_TOKEN_TTL_SECONDS,
    AUTHORIZATION_CODE_TTL_SECONDS,
    REFRESH_TOKEN_TTL_SECONDS,
    type IssuedTokens,
    type McpTokenClaims,
    type OAuthClientRecord,
    type OAuthCodeRecord,
    type OAuthTokenRecord,
} from "../ports/OAuthTypes"

/** How stale `last_used_at` must be before resolution bothers to rewrite it.
 *  Without this, every single MCP call would cost an extra write. */
const LAST_USED_REFRESH_MS = 60_000

export interface ClientCredentials {
    clientId: string | null
    clientSecret: string | null
}

export interface CodeExchangeRequest extends ClientCredentials {
    code: string | null
    redirectUri: string | null
    codeVerifier: string | null
    resource: string | null
}

export interface RefreshRequest extends ClientCredentials {
    refreshToken: string | null
    scope: string | null
}

export class OAuthTokenService {
    constructor(
        private readonly clients: OAuthClientRepository,
        private readonly codes: OAuthCodeRepository,
        private readonly tokens: OAuthTokenRepository,
    ) {}

    // ─── grant_type=authorization_code ──────────────────────────────────────

    async exchangeCode(req: CodeExchangeRequest): Promise<Result<IssuedTokens, OAuthError>> {
        const client = await this.authenticateClient(req)
        if (!client.ok) return client

        if (!req.code) return err(OAuthError.invalidRequest("code is required"))
        if (!req.redirectUri) return err(OAuthError.invalidRequest("redirect_uri is required"))
        if (!req.codeVerifier) return err(OAuthError.invalidRequest("code_verifier is required (PKCE)"))

        const codeHash = await OpaqueSecret.hash(req.code)

        let found: OAuthCodeRecord | null
        try {
            found = await this.codes.find(codeHash)
        } catch (e) {
            return err(OAuthError.serverError(e instanceof Error ? e.message : "code lookup failed"))
        }
        if (!found) return this.denyCode("no such code")
        const record = found

        // Already redeemed → treat as compromise, not as a retry.
        if (record.consumedAt) {
            await this.safely(() => this.tokens.revokeByCodeHash(codeHash))
            return this.denyCode("already redeemed - descended tokens revoked")
        }
        if (Date.parse(record.expiresAt) <= Date.now()) {
            const lateBy = Math.round((Date.now() - Date.parse(record.expiresAt)) / 1000)
            return this.denyCode(`expired ${lateBy}s ago (ttl ${AUTHORIZATION_CODE_TTL_SECONDS}s)`)
        }
        if (record.clientId !== client.value.clientId) {
            return this.denyCode("client_id does not match the code")
        }
        // Byte-exact: the redirect_uri presented here must be the one the code was
        // minted against, which is itself one of the client's registered URIs.
        if (record.redirectUri !== req.redirectUri) {
            return this.denyCode("redirect_uri does not match the code")
        }

        if (!(await Pkce.verify(req.codeVerifier, record.codeChallenge))) {
            // A wrong verifier means whoever holds this code is not who requested
            // it. Burn the code so the real client's later, correct attempt can't
            // be the one that succeeds for an interceptor sitting in between.
            await this.safely(() => this.codes.consume(codeHash).then(() => undefined))
            return this.denyCode("PKCE code_verifier did not match - code burned")
        }

        // RFC 8707: if the client names a resource now, it must be the one the
        // code was bound to at consent time.
        if (req.resource && record.resource && req.resource !== record.resource) {
            return err(OAuthError.invalidTarget("resource does not match the approved resource"))
        }

        // The single-use gate. Everything above is a read; THIS is the commit.
        let won: boolean
        try {
            won = await this.codes.consume(codeHash)
        } catch (e) {
            return err(OAuthError.serverError(e instanceof Error ? e.message : "could not consume code"))
        }
        if (!won) {
            // Lost the race with a concurrent exchange of the same code.
            await this.safely(() => this.tokens.revokeByCodeHash(codeHash))
            return this.denyCode("lost the single-use race with a concurrent exchange")
        }

        return this.issue(record.clientId, record.userId, record.scope, codeHash)
    }

    // ─── grant_type=refresh_token ───────────────────────────────────────────

    async refresh(req: RefreshRequest): Promise<Result<IssuedTokens, OAuthError>> {
        const client = await this.authenticateClient(req)
        if (!client.ok) return client
        if (!req.refreshToken) return err(OAuthError.invalidRequest("refresh_token is required"))

        let found: OAuthTokenRecord | null
        try {
            found = await this.tokens.findByRefreshHash(await OpaqueSecret.hash(req.refreshToken))
        } catch (e) {
            return err(OAuthError.serverError(e instanceof Error ? e.message : "refresh lookup failed"))
        }
        if (!found) return err(OAuthError.invalidGrant("refresh token is invalid or has expired"))
        const record = found
        if (record.clientId !== client.value.clientId) {
            return err(OAuthError.invalidGrant("refresh token is invalid or has expired"))
        }

        // Presented after it was already rotated/revoked → someone kept a copy.
        if (record.revokedAt) {
            await this.safely(() => this.tokens.revokeFamily(record.userId, record.clientId))
            return err(OAuthError.invalidGrant("refresh token is invalid or has expired"))
        }
        if (record.refreshExpiresAt && Date.parse(record.refreshExpiresAt) <= Date.now()) {
            return err(OAuthError.invalidGrant("refresh token is invalid or has expired"))
        }

        // A down-scoped refresh is legal (RFC 6749 §6) but there is only one scope,
        // so anything other than that is a mistake worth reporting.
        if (req.scope) {
            const requested = req.scope.trim().split(/\s+/).filter(Boolean)
            if (requested.some((s) => s !== MCP_SCOPE)) {
                return err(OAuthError.invalidScope(`only "${MCP_SCOPE}" is supported`))
            }
        }

        // ROTATE: the presented token dies here. Atomic, so two concurrent uses
        // cannot both mint a successor.
        let rotated: boolean
        try {
            rotated = await this.tokens.revoke(record.id)
        } catch (e) {
            return err(OAuthError.serverError(e instanceof Error ? e.message : "could not rotate refresh token"))
        }
        if (!rotated) {
            await this.safely(() => this.tokens.revokeFamily(record.userId, record.clientId))
            return err(OAuthError.invalidGrant("refresh token is invalid or has expired"))
        }

        return this.issue(record.clientId, record.userId, record.scope, record.codeHash)
    }

    // ─── RFC 7009 revocation ────────────────────────────────────────────────

    /** Revoke an access OR refresh token. Never throws and never reports whether
     *  the token existed — RFC 7009 §2.2 requires a 200 either way, so that this
     *  endpoint can't be used to probe which tokens are live. */
    async revoke(rawToken: string | null, presentedClientId: string | null): Promise<void> {
        if (!rawToken) return
        try {
            const hash = await OpaqueSecret.hash(rawToken)
            const record =
                (await this.tokens.findByAccessHash(hash)) ?? (await this.tokens.findByRefreshHash(hash))
            if (!record) return
            // A client may only revoke its OWN tokens.
            if (presentedClientId && record.clientId !== presentedClientId) return
            await this.tokens.revoke(record.id)
        } catch {
            // Swallowed on purpose: the caller gets 200 regardless.
        }
    }

    // ─── resource-server side ───────────────────────────────────────────────

    /** Resolve a raw bearer token to its claims, or null if unknown/expired/
     *  revoked. MUST NOT throw — a malformed token from an unauthenticated caller
     *  is an ordinary outcome, not an exception. */
    async resolveAccessToken(rawToken: string): Promise<McpTokenClaims | null> {
        try {
            if (typeof rawToken !== "string") return null
            const raw = rawToken.trim()
            if (!raw) return null

            const record = await this.tokens.findByAccessHash(await OpaqueSecret.hash(raw))
            if (!record) return null
            if (record.revokedAt) return null
            if (Date.parse(record.expiresAt) <= Date.now()) return null

            // Best effort, and rate-limited to one write a minute so a busy MCP
            // session doesn't pay for the audit trail on every call.
            const last = record.lastUsedAt ? Date.parse(record.lastUsedAt) : 0
            if (!last || Date.now() - last > LAST_USED_REFRESH_MS) {
                await this.tokens.touchLastUsed(record.id)
            }

            return {
                userId: record.userId,
                clientId: record.clientId,
                scopes: record.scope.split(/\s+/).filter(Boolean),
                expiresAt: record.expiresAt,
            }
        } catch {
            return null
        }
    }

    // ─── internals ──────────────────────────────────────────────────────────

    /** Refuse a code grant.
     *
     *  Every refusal returns the SAME message to the client on purpose: one that
     *  could tell "expired" from "wrong client" from "already redeemed" is an
     *  oracle for probing codes. That is right for the client and useless for an
     *  operator, who then sees only "Couldn't connect" with no way to tell a
     *  timing problem from a misconfigured client — so the real reason is logged
     *  server-side (captured by Workers observability) and never transmitted. */
    private denyCode(reason: string): Result<never, OAuthError> {
        console.warn(`[oauth] authorization_code refused: ${reason}`)
        return err(OAuthError.invalidGrant("authorization code is invalid or has expired"))
    }

    /** Identify (and, for a confidential client, authenticate) the caller. */
    private async authenticateClient(creds: ClientCredentials): Promise<Result<OAuthClientRecord, OAuthError>> {
        if (!creds.clientId) return err(OAuthError.invalidClient("client_id is required"))

        let client: OAuthClientRecord | null
        try {
            client = await this.clients.find(creds.clientId)
        } catch (e) {
            return err(OAuthError.serverError(e instanceof Error ? e.message : "client lookup failed"))
        }
        if (!client) return err(OAuthError.invalidClient("unknown client"))

        if (client.tokenEndpointAuthMethod === "none") {
            // A public client authenticates with PKCE, not a secret. It has no
            // secret to present, so nothing further to check.
            return ok(client)
        }
        if (!creds.clientSecret || !client.clientSecretHash) {
            return err(OAuthError.invalidClient("client authentication failed"))
        }
        const presented = await OpaqueSecret.hash(creds.clientSecret)
        if (!OpaqueSecret.equals(presented, client.clientSecretHash)) {
            return err(OAuthError.invalidClient("client authentication failed"))
        }
        return ok(client)
    }

    /** Mint and persist a fresh access/refresh pair. */
    private async issue(
        clientId: string,
        userId: string,
        scope: string,
        codeHash: string | null,
    ): Promise<Result<IssuedTokens, OAuthError>> {
        const accessToken = OpaqueSecret.mint(OpaqueSecret.ACCESS_PREFIX)
        const refreshToken = OpaqueSecret.mint(OpaqueSecret.REFRESH_PREFIX)
        const now = Date.now()

        try {
            await this.tokens.create({
                tokenHash: await OpaqueSecret.hash(accessToken),
                refreshHash: await OpaqueSecret.hash(refreshToken),
                clientId,
                userId,
                scope,
                expiresAt: new Date(now + ACCESS_TOKEN_TTL_SECONDS * 1000).toISOString(),
                refreshExpiresAt: new Date(now + REFRESH_TOKEN_TTL_SECONDS * 1000).toISOString(),
                codeHash,
            })
        } catch (e) {
            return err(OAuthError.serverError(e instanceof Error ? e.message : "could not issue tokens"))
        }

        return ok({
            accessToken,
            refreshToken,
            tokenType: "Bearer",
            expiresIn: ACCESS_TOKEN_TTL_SECONDS,
            scope,
        })
    }

    /** Run a compensating action whose failure must not change the outcome we
     *  already decided on (all of them are "revoke more, just in case"). */
    private async safely(fn: () => Promise<unknown>): Promise<void> {
        try {
            await fn()
        } catch {
            /* deliberately ignored */
        }
    }
}
