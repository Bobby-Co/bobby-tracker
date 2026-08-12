// Opaque-secret primitives for the MCP Authorization Server: mint, hash, and
// compare the authorization codes / access tokens / refresh tokens / client
// secrets this module issues.
//
// WHY OPAQUE AND NOT A JWT. The Authorization Server and the Resource Server are
// the same app on the same origin, so "validating" a token is a single indexed
// lookup — a signature buys nothing and would cost a signing key this app does
// not have. It also buys the opposite of what we want: a JWT stays valid until it
// expires, whereas a row with `revoked_at` stops working the instant it is set.
//
// WEB CRYPTO ONLY. The deploy target is Cloudflare Workers via OpenNext, so this
// file uses the `crypto` global (`getRandomValues`, `subtle.digest`) and `btoa` —
// never node:crypto, never Buffer. Pure by the modules/README definition: value
// production and hashing, no I/O.

export class OpaqueSecret {
    /** Prefix on every access token — lets a human (and a log scrubber) recognise one. */
    static readonly ACCESS_PREFIX = "bmcp_"
    /** Prefix on every refresh token. Still inside the `bmcp_` family. */
    static readonly REFRESH_PREFIX = "bmcp_rt_"
    /** Prefix on an authorization code (never leaves the redirect that carries it). */
    static readonly CODE_PREFIX = "bmcp_ac_"
    /** Prefix on a confidential client's secret. */
    static readonly CLIENT_SECRET_PREFIX = "bmcp_cs_"

    /** 256 bits of CSPRNG entropy, base64url, behind `prefix`. */
    static mint(prefix: string): string {
        const bytes = new Uint8Array(32)
        crypto.getRandomValues(bytes)
        return prefix + base64url(bytes)
    }

    /** A client_id. Not a secret — just needs to be unguessable enough that a
     *  registration can't be squatted, and short enough to paste. */
    static mintClientId(): string {
        const bytes = new Uint8Array(16)
        crypto.getRandomValues(bytes)
        return `mcp_${base64url(bytes)}`
    }

    /** SHA-256 of the RAW secret (prefix included), base64url. The ONLY form that
     *  is ever persisted. */
    static async hash(raw: string): Promise<string> {
        const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw))
        return base64url(new Uint8Array(digest))
    }

    /** Length-then-content comparison with no early exit, so a caller can't time
     *  its way to a valid hash/challenge. */
    static equals(a: string, b: string): boolean {
        if (a.length !== b.length) return false
        let diff = 0
        for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
        return diff === 0
    }
}

/** RFC 4648 §5 base64url, unpadded. `btoa` is a Workers/Node global; Buffer is not
 *  available on Workers, hence the manual binary-string step. */
export function base64url(bytes: Uint8Array): string {
    let binary = ""
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}
