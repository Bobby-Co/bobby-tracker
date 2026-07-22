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

// Always pin path to "/" so cookies are visible to every route.
// Without this, document.cookie in the browser defaults the path to
// whatever URL set the cookie — meaning a PKCE verifier written from
// /login isn't sent when the OAuth round-trip lands on /auth/callback,
// and exchangeCodeForSession fails with "code verifier not found".
// `domain` is only set when NEXT_PUBLIC_AUTH_COOKIE_DOMAIN is provided
// (production cross-subdomain SSO); dev leaves it host-scoped.
function sharedCookieOptions() {
    const domain = process.env.NEXT_PUBLIC_AUTH_COOKIE_DOMAIN
    if (domain) {
        return { domain, path: "/", sameSite: "lax" as const, secure: true }
    }
    return { path: "/", sameSite: "lax" as const }
}
