import { createServerClient, type CookieOptions } from "@supabase/ssr"
import { createClient as createSupabaseClient } from "@supabase/supabase-js"
import { cookies } from "next/headers"
import { cache } from "react"
import type { User } from "@supabase/supabase-js"
import { AuthJwt } from "@/lib/server/AuthJwt"

// The server-side Supabase seam. Static factories (the app has no persistent
// object registry — it's a Next host — so these stay static rather than an
// injected instance): `Supabase.rls()` for the request-scoped RLS client,
// `Supabase.service()` for the trusted service-role client, and
// `Supabase.currentUser()` for the cached current user.
export class Supabase {
    // Server-side Supabase client used inside Server Components and Route
    // Handlers. Reads/writes the auth cookies (with the shared cookie domain when
    // configured) so the session round-trips between the CI app and the tracker
    // without re-login. Bound to the `tracker` schema. RLS-enforced — this is the
    // client requests should use; contrast Supabase.service() which bypasses RLS.
    static async rls() {
        const cookieStore = await cookies()
        return createServerClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
            {
                db: { schema: "tracker" },
                cookieOptions: sharedCookieOptions(),
                cookies: {
                    getAll: () => cookieStore.getAll(),
                    setAll: (toSet: { name: string; value: string; options: CookieOptions }[]) => {
                        try {
                            toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
                        } catch {
                            // Server Components can't set cookies, so a refresh
                            // triggered during RSC render is dropped here. That's
                            // fine: the browser Supabase client (AuthProvider) owns
                            // refresh now, and route handlers — which CAN set
                            // cookies — persist any refresh they trigger.
                        }
                    },
                },
            },
        )
    }

    /** The cached current authenticated user (one decode per request). */
    static currentUser(): Promise<User | null> {
        return currentUserCached()
    }

    // Service-role client for trusted server-only operations (e.g. forwarding
    // indexing jobs to the analyser). Bypasses RLS — never expose to clients.
    static service() {
        return createSupabaseClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!,
            { db: { schema: "tracker" }, auth: { persistSession: false } },
        )
    }

    /** Service-role client for ANOTHER REGION's database — the data plane.
     *
     *  Takes the credentials rather than a cell id so this stays a dumb factory:
     *  the regions module owns the topology, and this file owns how a client is
     *  built. Callers get the pair from RegionRegistry.cell().
     *
     *  Throws on missing credentials instead of falling back to the control
     *  database. A fallback here would be silent and wrong in the worst way: the
     *  request would succeed, read the wrong region, and return an empty result
     *  that is indistinguishable from "this team has no issues yet". */
    static forRegion(supabaseUrl: string, serviceKey: string, cellLabel: string) {
        if (!supabaseUrl || !serviceKey) {
            throw new Error(`cell ${cellLabel} has no data-plane database configured`)
        }
        return createSupabaseClient(supabaseUrl, serviceKey, {
            db: { schema: "tracker" },
            auth: { persistSession: false },
        })
    }
}

/** The request-scoped RLS server client type (what Supabase.rls() resolves to).
 *  Injected into infrastructure repositories that receive the caller's client;
 *  they `import type` this so they need no runtime dependency on the seam. */
export type SupabaseRlsClient = Awaited<ReturnType<typeof Supabase.rls>>

/** What a RequestContext holds. Service-role since the RLS-to-AccessService
 *  migration: the server decides access before it queries, so it no longer asks
 *  the database to re-derive it. Two invariants enforced in CI make that safe —
 *  lib/server/http/route-authz.test.ts (every route reaching tenant data carries
 *  a tenant guard) and repository-scoping.test.ts (every tenant query carries a
 *  predicate; every mutation a keyed one).
 *
 *  This is ALSO what makes a regional split possible: a service-role client can
 *  be pointed at another region's database, whereas an RLS client is bound to a
 *  JWT that only its own project can validate. */
export type SupabaseServiceClient = ReturnType<typeof Supabase.service>

// Always pin path to "/" so the session cookie + PKCE verifier are visible to
// every route. Without an explicit path, browser cookies default to the URL that
// set them — the verifier written from /login then doesn't get sent on
// /auth/callback and exchangeCodeForSession fails with "code verifier not found".
// `domain` is only set when NEXT_PUBLIC_AUTH_COOKIE_DOMAIN is provided (production
// cross-subdomain SSO); dev leaves it host-scoped.
function sharedCookieOptions() {
    const domain = process.env.NEXT_PUBLIC_AUTH_COOKIE_DOMAIN
    if (domain) {
        return { domain, path: "/", sameSite: "lax" as const, secure: true }
    }
    return { path: "/", sameSite: "lax" as const }
}

// Cached per-request fetch of the current authenticated user.
//
// Fast path: decode the access-token JWT directly from the cookie (AuthJwt). No
// network call. The token is signed by Supabase; its payload tells us who the user
// is. We don't verify the signature here because RLS at the database is the actual
// security boundary — every query sends the cookie and Supabase auth validates it
// there. A forged cookie can lie to *our* UI but can't read or write any data.
//
// Slow path: only when the cookie is missing or the access token is past its
// expiry do we fall back to auth.getUser() through the supabase-js client, which
// will refresh the token if it can. We catch refresh failures
// (`refresh_token_not_found` etc.) so a stale cookie returns null cleanly instead
// of spamming the logs on every page load.
//
// React's cache() makes this a single decode per request even when half a dozen
// server components ask for the user.
const currentUserCached = cache(async (): Promise<User | null> => {
    const jwt = new AuthJwt()
    const cookieStore = await cookies()
    const decoded = jwt.decodeFromCookies(cookieStore.getAll())
    if (decoded && jwt.isFresh(decoded)) return decoded.user
    if (!decoded) {
        // No auth cookie at all → definitively anonymous.
        const hasAuthCookie = cookieStore.getAll().some((c) => c.name.startsWith("sb-"))
        if (!hasAuthCookie) return null
    }

    // Cookie present but expired (or unparseable) — give supabase-js a chance to
    // refresh. Wrap so a dead refresh token returns null rather than throwing into
    // every render.
    try {
        const supabase = await Supabase.rls()
        const {
            data: { user },
        } = await supabase.auth.getUser()
        return user
    } catch {
        return null
    }
})
