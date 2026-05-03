import { createServerClient, type CookieOptions } from "@supabase/ssr"
import { createClient as createSupabaseClient } from "@supabase/supabase-js"
import { cookies } from "next/headers"
import { cache } from "react"
import type { User } from "@supabase/supabase-js"

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
// auth.getUser() is a network round-trip to Supabase auth (it
// validates the JWT with the auth server, not just decodes the
// cookie). Multiple components / helpers in the same request all
// need the user; React's `cache()` deduplicates so we pay for the
// round-trip once instead of three or four times.
//
// Cookie sniff: Supabase only persists session via cookies prefixed
// with `sb-`. No such cookie → no possible session → return null
// without calling auth at all. This matters most on public routes
// where the typical visitor is anonymous; without the short-circuit
// every public page hit was burning a Supabase auth call and helping
// trigger `over_request_rate_limit` errors.
export const getCurrentUser = cache(async (): Promise<User | null> => {
    const cookieStore = await cookies()
    const hasAuthCookie = cookieStore.getAll().some((c) => c.name.startsWith("sb-"))
    if (!hasAuthCookie) return null

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    return user
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
