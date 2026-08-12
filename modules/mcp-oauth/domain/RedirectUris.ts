// The redirect-URI policy for Dynamic Client Registration and for the authorize
// endpoint. This is the single most security-critical rule in the whole server:
// a redirect_uri is where the authorization code is delivered, so anything we
// accept here is somewhere a code can be sent.
//
// WHAT IS ALLOWED
//   • any https:// URI                       — a hosted client (claude.ai)
//   • http://127.0.0.1:*/… , http://[::1]:*/…, http://localhost:*/…
//                                            — a native client's loopback
//                                              callback (Claude Code), which
//                                              RFC 8252 §7.3 explicitly blesses
//
// WHAT IS REFUSED, and why it matters
//   • javascript:, data:, file:, custom schemes — turn a redirect into script
//     execution or an exfiltration sink.
//   • plain http:// to any NON-loopback host   — the code would cross the network
//     in the clear.
//   • a URI carrying a fragment                — RFC 6749 §3.1.2 forbids it; the
//     authorization response builds its own query/fragment.
//   • userinfo (user:pass@host)                — ambiguous origin, a classic
//     parser-confusion vector.
//
// Registration is unauthenticated, so it is also rate-limited by COUNT and LENGTH
// here: an attacker cannot use it to stuff megabytes into the table.

/** Hosts whose plain-http origin is still trustworthy (RFC 8252 loopback). */
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"])

export class RedirectUris {
    /** Most clients register 1–2. Ten is generous and bounds the row size. */
    static readonly MAX_COUNT = 10
    /** Comfortably longer than any real callback, far shorter than a payload. */
    static readonly MAX_LENGTH = 2048

    /** Is this ONE URI acceptable to register? */
    static isAllowed(raw: string): boolean {
        if (typeof raw !== "string") return false
        if (raw.length === 0 || raw.length > RedirectUris.MAX_LENGTH) return false

        let url: URL
        try {
            url = new URL(raw)
        } catch {
            return false // not absolute / not parseable → never acceptable
        }

        // RFC 6749 §3.1.2 — the redirection endpoint MUST NOT include a fragment.
        if (url.hash) return false
        // Ambiguous-origin vector.
        if (url.username || url.password) return false

        if (url.protocol === "https:") return url.hostname.length > 0
        if (url.protocol === "http:") {
            // URL normalises an IPv6 host to "[::1]" — compare the bare form.
            const host = url.hostname.replace(/^\[|\]$/g, "")
            return LOOPBACK_HOSTS.has(host)
        }
        return false
    }

    /** Validate a whole registration list. Returns the accepted list, or the RFC
     *  7591 reason it was refused. */
    static validateList(value: unknown): { ok: true; uris: string[] } | { ok: false; reason: string } {
        if (!Array.isArray(value) || value.length === 0) {
            return { ok: false, reason: "redirect_uris must be a non-empty array" }
        }
        if (value.length > RedirectUris.MAX_COUNT) {
            return { ok: false, reason: `at most ${RedirectUris.MAX_COUNT} redirect_uris are accepted` }
        }
        const uris: string[] = []
        for (const candidate of value) {
            if (typeof candidate !== "string" || !RedirectUris.isAllowed(candidate)) {
                return {
                    ok: false,
                    reason:
                        "each redirect_uri must be an absolute https:// URI, or an http:// URI on 127.0.0.1 / [::1] / localhost, with no fragment",
                }
            }
            if (!uris.includes(candidate)) uris.push(candidate)
        }
        return { ok: true, uris }
    }

    /** EXACT match against the registered set — no prefix matching, no
     *  normalisation, no "the port doesn't count". Anything looser is how
     *  redirect-URI allow-lists get bypassed. */
    static isRegistered(registered: readonly string[], candidate: string): boolean {
        return registered.some((uri) => uri === candidate)
    }

    /** An optional informational `client_uri`: same scheme rules, but it is never
     *  redirected to, only rendered as a link on the consent screen. */
    static isAllowedClientUri(raw: string): boolean {
        return RedirectUris.isAllowed(raw)
    }
}
