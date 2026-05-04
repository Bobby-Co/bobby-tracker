import { createServerClient, type CookieOptions } from "@supabase/ssr"
import { createClient as createSupabaseClient } from "@supabase/supabase-js"
import { cookies } from "next/headers"
import { cache } from "react"
import type { User } from "@supabase/supabase-js"
import { decodeAuthFromCookies, isStillFresh } from "@/lib/supabase/auth-jwt"

// Server-side Supabase client used inside Server Components and Route
// Handlers. Reads/writes the auth cookies (with the shared cookie
// domain when configured) so the session round-trips between the CI
// app and the tracker without re-login. Bound to the `tracker` schema.
export async function createClient() {
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
                        // Server Components can't set cookies — proxy.ts handles refresh there.
                    }
                },
            },
        },
    )
}

function sharedCookieOptions() {
    const domain = process.env.NEXT_PUBLIC_AUTH_COOKIE_DOMAIN
    return domain
        ? { domain, path: "/", sameSite: "lax" as const, secure: true }
        : undefined
}

// Cached per-request fetch of the current authenticated user.
//
// Fast path: decode the access-token JWT directly from the cookie.
// No network call. The token is signed by Supabase; its payload tells
// us who the user is. We don't verify the signature here because RLS
// at the database is the actual security boundary — every query sends
// the cookie and Supabase auth validates it there. A forged cookie
// can lie to *our* UI but can't read or write any data.
//
// Slow path: only when the cookie is missing or the access token is
// past its expiry do we fall back to auth.getUser() through the
// supabase-js client, which will refresh the token if it can. We
// catch refresh failures (`refresh_token_not_found` etc.) so a stale
// cookie returns null cleanly instead of spamming the logs on every
// page load.
//
// React's cache() makes this a single decode per request even when
// half a dozen server components ask for the user.
export const getCurrentUser = cache(async (): Promise<User | null> => {
    const cookieStore = await cookies()
    const decoded = decodeAuthFromCookies(cookieStore.getAll())
    if (decoded && isStillFresh(decoded)) return decoded.user
    if (!decoded) {
        // No auth cookie at all → definitively anonymous.
        const hasAuthCookie = cookieStore.getAll().some((c) => c.name.startsWith("sb-"))
        if (!hasAuthCookie) return null
    }

    // Cookie present but expired (or unparseable) — give supabase-js
    // a chance to refresh. Wrap so a dead refresh token returns null
    // rather than throwing into every render.
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        return user
    } catch {
        return null
    }
})

// Service-role client for trusted server-only operations (e.g. forwarding
// indexing jobs to the analyser). Bypasses RLS — never expose to clients.
export function createServiceClient() {
    return createSupabaseClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { db: { schema: "tracker" }, auth: { persistSession: false } },
    )
}
