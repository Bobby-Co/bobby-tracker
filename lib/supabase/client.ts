"use client"

import { createBrowserClient } from "@supabase/ssr"

// Browser-side Supabase client. Bound to the `tracker` schema and shares
// the auth cookie with Bobby/service via NEXT_PUBLIC_AUTH_COOKIE_DOMAIN
// (e.g. ".bobby.example.com") so a user logged into the CI app is
// automatically logged in here. Leave the env var empty in dev; production
// must set it to the parent domain of both apps.
export function createClient() {
    return createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            db: { schema: "tracker" },
            cookieOptions: sharedCookieOptions(),
        },
    )
}

function sharedCookieOptions() {
    const domain = process.env.NEXT_PUBLIC_AUTH_COOKIE_DOMAIN
    return domain
        ? { domain, path: "/", sameSite: "lax" as const, secure: true }
        : undefined
}
