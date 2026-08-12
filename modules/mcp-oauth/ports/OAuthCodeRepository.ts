// mcp-oauth — the authorization-code persistence PORT.

import type { NewOAuthCode, OAuthCodeRecord } from "./OAuthTypes"

export interface OAuthCodeRepository {
    /** Store a freshly minted (already hashed) code. Throws on failure. */
    create(code: NewOAuthCode): Promise<void>

    /** Look a code up by its hash; null when unknown. Throws on failure. */
    find(codeHash: string): Promise<OAuthCodeRecord | null>

    /** ATOMIC single-use claim: stamp consumed_at only if it is still null, and
     *  report whether THIS call was the one that did it. Two concurrent token
     *  requests carrying the same code therefore have exactly one winner — the
     *  loser is a replay and the caller must refuse it AND revoke what the code
     *  already issued. Throws on infrastructure failure. */
    consume(codeHash: string): Promise<boolean>
}
