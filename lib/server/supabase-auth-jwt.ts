// Decode the Supabase auth cookie locally without calling the auth
// server. The access token in the cookie is a JWT signed by Supabase;
// for routing / UI we trust its payload directly. Data security still
// flows through RLS — every query sends the cookie, Supabase validates
// the signature at the database. A forged cookie can lie about identity
// to *our* UI but can't actually read or write anything.
//
// This eliminates the auth.getUser() / getSession() round-trips that
// were tripping `over_request_rate_limit` under refresh-heavy traffic.
//
// Why not signature-verify? It would mean shipping the JWT secret to
// every render path and re-implementing what Supabase auth already
// does at the database. The signature is what makes RLS safe; we
// don't need it for "show this user's name in the header".

import type { User } from "@supabase/supabase-js"

export interface CookieEntry { name: string; value: string }

// Find and reassemble the Supabase auth token cookie. @supabase/ssr
// chunks large cookie values across `…auth-token.0`, `.1`, … so we
// concatenate them in order before parsing. The PKCE code-verifier
// cookie also starts with `sb-` and ends with `-code-verifier` —
// we deliberately skip it.
function readAuthCookieValue(cookies: CookieEntry[]): string | null {
    const authCookies = cookies.filter(
        (c) => c.name.startsWith("sb-") &&
            !c.name.endsWith("-code-verifier") &&
            (c.name.endsWith("-auth-token") || /-auth-token\.\d+$/.test(c.name)),
    )
    if (authCookies.length === 0) return null

    // Single-cookie case
    const single = authCookies.find((c) => c.name.endsWith("-auth-token"))
    if (single && authCookies.length === 1) return single.value

    // Chunked case — sort by trailing index, concat
    const chunks = authCookies
        .filter((c) => /-auth-token\.\d+$/.test(c.name))
        .sort((a, b) => {
            const ai = Number(a.name.split(".").pop())
            const bi = Number(b.name.split(".").pop())
            return ai - bi
        })
    if (chunks.length === 0) return single?.value ?? null
    return chunks.map((c) => c.value).join("")
}

function base64UrlDecode(s: string): string {
    const padded = s.replace(/-/g, "+").replace(/_/g, "/") +
        "=".repeat((4 - (s.length % 4)) % 4)
    return Buffer.from(padded, "base64").toString("utf-8")
}

function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
    const parts = jwt.split(".")
    if (parts.length !== 3) return null
    try {
        return JSON.parse(base64UrlDecode(parts[1]))
    } catch {
        return null
    }
}

interface DecodedSession {
    user: User
    /** Access-token expiry in unix seconds. */
    exp: number
}

// Parse a Supabase cookie value into the authenticated user. Tolerant
// of the various shapes @supabase/ssr writes: legacy plain JSON, the
// new `base64-`-prefixed encoding, an array `[access_token, refresh_token, …]`,
// or an object `{ access_token, refresh_token, … }`.
export function decodeAuthFromCookies(cookies: CookieEntry[]): DecodedSession | null {
    const raw = readAuthCookieValue(cookies)
    if (!raw) return null

    let body = raw
    if (body.startsWith("base64-")) {
        try {
            body = Buffer.from(body.slice("base64-".length), "base64").toString("utf-8")
        } catch { return null }
    }

    let parsed: unknown
    try { parsed = JSON.parse(body) } catch { return null }

    let accessToken: string | undefined
    if (Array.isArray(parsed) && typeof parsed[0] === "string") {
        accessToken = parsed[0]
    } else if (parsed && typeof parsed === "object") {
        const obj = parsed as Record<string, unknown>
        if (typeof obj.access_token === "string") accessToken = obj.access_token
    }
    if (!accessToken) return null

    const payload = decodeJwtPayload(accessToken)
    if (!payload) return null
    const sub = typeof payload.sub === "string" ? payload.sub : null
    const exp = typeof payload.exp === "number" ? payload.exp : 0
    if (!sub) return null

    const email = typeof payload.email === "string" ? payload.email : undefined
    const role = typeof payload.role === "string" ? payload.role : undefined
    const aud = typeof payload.aud === "string" ? payload.aud : "authenticated"
    const app_metadata = (payload.app_metadata && typeof payload.app_metadata === "object")
        ? payload.app_metadata as Record<string, unknown>
        : {}
    const user_metadata = (payload.user_metadata && typeof payload.user_metadata === "object")
        ? payload.user_metadata as Record<string, unknown>
        : {}

    // Cast a minimal-but-shaped object to Supabase's User. We fill the
    // fields callers actually read (id, email, app_metadata,
    // user_metadata, aud, role); the rest stay as undefined and never
    // surface in our app's reads.
    const user = {
        id: sub,
        email,
        app_metadata,
        user_metadata,
        aud,
        role,
        created_at: "",
    } as unknown as User

    return { user, exp }
}

// True when the access-token expiry is at least `bufferSeconds` away.
// We add a small buffer (default 30s) so we don't hand back a token
// that's about to expire mid-request.
export function isStillFresh(decoded: DecodedSession, bufferSeconds = 30): boolean {
    return decoded.exp * 1000 > Date.now() + bufferSeconds * 1000
}
