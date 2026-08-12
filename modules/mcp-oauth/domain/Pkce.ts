// PKCE (RFC 7636) — the only thing standing between a stolen authorization code
// and an access token, because every client we register is PUBLIC (no secret).
//
// S256 ONLY. `plain` is rejected at the authorize endpoint rather than here, so
// the refusal can be reported to the user before any code exists; this class
// simply has no code path that would accept it.

import { OpaqueSecret, base64url } from "./OpaqueSecret"

// RFC 7636 §4.1: 43–128 characters from [A-Z] / [a-z] / [0-9] / "-" / "." / "_" / "~".
const VERIFIER_RE = /^[A-Za-z0-9\-._~]{43,128}$/
// A challenge is base64url(SHA-256(verifier)) → 43 unpadded base64url chars.
const CHALLENGE_RE = /^[A-Za-z0-9\-_]{43}$/

export class Pkce {
    static readonly METHOD = "S256"

    /** Shape check on an inbound `code_challenge`. A malformed challenge can never
     *  be satisfied, so refusing it up front turns a guaranteed later failure into
     *  an immediate, explainable one. */
    static isWellFormedChallenge(challenge: string): boolean {
        return CHALLENGE_RE.test(challenge)
    }

    /** Shape check on an inbound `code_verifier`. */
    static isWellFormedVerifier(verifier: string): boolean {
        return VERIFIER_RE.test(verifier)
    }

    /** base64url(SHA-256(ascii(code_verifier))) — the S256 transformation. */
    static async challengeFor(verifier: string): Promise<string> {
        const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))
        return base64url(new Uint8Array(digest))
    }

    /** True when `verifier` is the pre-image of `challenge`. Constant-time compare. */
    static async verify(verifier: string, challenge: string): Promise<boolean> {
        if (!Pkce.isWellFormedVerifier(verifier)) return false
        return OpaqueSecret.equals(await Pkce.challengeFor(verifier), challenge)
    }
}
