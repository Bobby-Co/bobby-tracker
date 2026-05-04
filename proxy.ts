import { NextResponse, type NextRequest } from "next/server"
import { createServerClient, type CookieOptions } from "@supabase/ssr"
import { decodeAuthFromCookies, isStillFresh } from "@/lib/supabase/auth-jwt"

// Auth gate + cookie hygiene for every request.
//
// Per-page cost we want to avoid: a network round-trip to Supabase
// auth (auth.getUser / getSession) on every request was both slow and
// rapidly tripping `over_request_rate_limit` under refresh-heavy
// usage. So we use a three-tier strategy:
//
//   1. No `sb-*` cookie at all → visitor is anonymous, no work to do.
//
//   2. Cookie present and the access-token JWT decodes locally + is
//      still fresh → we have a user without touching the network.
//      RLS still validates the token on every data query, so trusting
//      the local payload here doesn't weaken security.
//
//   3. Cookie present but expired or unparseable → ask supabase-js to
//      refresh. If the refresh token itself is dead (a common stale-
//      cookie scenario after long idle times) we catch the error and
//      *clear* the sb-* cookies in the response so the next request
//      doesn't loop on the same dead refresh — the user gets a clean
//      anonymous state and a single redirect to /login.
//
// Next 16 renamed `middleware.ts` to `proxy.ts`.
export async function proxy(request: NextRequest) {
    let response = NextResponse.next({ request })

    const path = request.nextUrl.pathname
    const isPublic =
        path === "/" ||
        path === "/login" ||
        path.startsWith("/auth/") ||
        path.startsWith("/_next/") ||
        path.startsWith("/api/auth/") ||
        path.startsWith("/p/") ||
        path === "/api/public-issues" ||
        path.startsWith("/api/public-issues/") ||
        path === "/favicon.ico"

    const allCookies = request.cookies.getAll()
    const hasAuthCookie = allCookies.some((c) => c.name.startsWith("sb-"))

    // Tier 1: no auth cookie → anonymous. Skip everything.
    if (!hasAuthCookie) {
        if (!isPublic) return redirectToLogin(request, path)
        return response
    }

    // Tier 2: local JWT decode. Steady state — no network call.
    const decoded = decodeAuthFromCookies(allCookies)
    if (decoded && isStillFresh(decoded)) {
        if (path === "/" || path === "/login") {
            return NextResponse.redirect(new URL("/projects", request.url))
        }
        return response
    }

    // Tier 3: token expired or unparseable. Build the supabase client
    // so it can refresh, but do it inside a try/catch — a dead refresh
    // token here is the source of the `refresh_token_not_found` log
    // spam. On failure we clear the cookies and treat as anonymous.
    // Pin path to "/" so cookie writes here line up with the ones the
    // server / browser clients make — see lib/supabase/server.ts for
    // the full rationale (PKCE verifier visibility on /auth/callback).
    const cookieDomain = process.env.NEXT_PUBLIC_AUTH_COOKIE_DOMAIN
    const sharedCookieOptions = cookieDomain
        ? { domain: cookieDomain, path: "/", sameSite: "lax" as const, secure: true }
        : { path: "/", sameSite: "lax" as const }

    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            db: { schema: "tracker" },
            cookieOptions: sharedCookieOptions,
            cookies: {
                getAll: () => request.cookies.getAll(),
                setAll: (toSet: { name: string; value: string; options: CookieOptions }[]) => {
                    toSet.forEach(({ name, value }) => request.cookies.set(name, value))
                    response = NextResponse.next({ request })
                    toSet.forEach(({ name, value, options }) =>
                        response.cookies.set(name, value, options),
                    )
                },
            },
        },
    )

    let user = null
    try {
        const { data } = await supabase.auth.getSession()
        user = data.session?.user ?? null
    } catch {
        // Refresh failed — wipe the bad cookies so the next request
        // takes the fast anonymous path instead of looping here.
        for (const c of allCookies) {
            if (c.name.startsWith("sb-")) {
                response.cookies.set(c.name, "", { ...sharedCookieOptions, maxAge: 0 })
            }
        }
        if (!isPublic) return redirectToLogin(request, path)
        return response
    }

    if (!user && !isPublic) return redirectToLogin(request, path)
    if (user && (path === "/" || path === "/login")) {
        return NextResponse.redirect(new URL("/projects", request.url))
    }
    return response
}

function redirectToLogin(request: NextRequest, path: string) {
    const url = request.nextUrl.clone()
    url.pathname = "/login"
    url.searchParams.set("next", path)
    return NextResponse.redirect(url)
}

export const config = {
    // Skip Next's internal asset paths and any URL with a file extension
    // (images, fonts, source maps, etc.). We deliberately keep /p/* and
    // /api/public-issues* in scope so an authenticated visitor's tokens
    // get refreshed when they hit invite-only links.
    matcher: [
        "/((?!_next/static|_next/image|_next/data|favicon\\.ico|robots\\.txt|sitemap\\.xml|.*\\..*).*)",
    ],
}
