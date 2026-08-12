// mcp-oauth — the issued-token persistence PORT.

import type { NewOAuthToken, OAuthTokenRecord, OAuthConnection } from "./OAuthTypes"

export interface OAuthTokenRepository {
    /** The caller's LIVE connections — one row per unissued-revoked token, with the
     *  client's display name resolved. Backs the "connected apps" management screen,
     *  so it deliberately exposes no hashes. Throws on failure. */
    listConnectionsForUser(userId: string): Promise<OAuthConnection[]>

    /** Revoke one token ON BEHALF OF its owner. `userId` is part of the WHERE
     *  clause rather than a prior check, so another user's token id simply matches
     *  nothing — there is no window between the ownership test and the write.
     *  Returns whether this call performed the revocation. Throws on failure. */
    revokeForUser(id: string, userId: string): Promise<boolean>
    /** Persist a newly issued access/refresh pair. Throws on failure. */
    create(token: NewOAuthToken): Promise<void>

    /** Find by access-token hash, regardless of revoked/expired state — the
     *  CALLER decides what those mean, so this stays a plain lookup. Throws on
     *  infrastructure failure. */
    findByAccessHash(tokenHash: string): Promise<OAuthTokenRecord | null>

    /** Find by refresh-token hash, same contract. */
    findByRefreshHash(refreshHash: string): Promise<OAuthTokenRecord | null>

    /** ATOMIC revoke: stamp revoked_at only if still null, reporting whether this
     *  call did it. A `false` on a refresh rotation means the token had already
     *  been rotated — i.e. refresh-token REUSE. Throws on failure. */
    revoke(id: string): Promise<boolean>

    /** Revoke every live token descended from one authorization code. Used when a
     *  code replay is detected (RFC 6749 §4.1.2). Throws on failure. */
    revokeByCodeHash(codeHash: string): Promise<void>

    /** Revoke every live token for one (user, client) pair — the response to
     *  detected refresh-token reuse (RFC 6819 §5.2.2.3), and the primitive a
     *  "disconnect this client" UI would call. Throws on failure. */
    revokeFamily(userId: string, clientId: string): Promise<void>

    /** Best-effort liveness stamp. MUST NOT throw — an audit nicety may never
     *  fail an otherwise valid request. */
    touchLastUsed(id: string): Promise<void>
}
