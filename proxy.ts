import { NextResponse, type NextRequest } from "next/server"
import { createServerClient, type CookieOptions } from "@supabase/ssr"

// Refreshes the Supabase auth cookies on every request and gates the
// /app/* routes behind authentication. /login, /auth/* and the public
// submission flow are open.
//
// Two rate-limit-aware optimizations:
//
//   1. If no Supabase auth cookie is present, the visitor is
//      definitely anonymous — skip building the supabase client and
//      calling auth at all. Saves a network round-trip on every
//      anonymous request (login page, public submission links, etc.).
//
//   2. Use auth.getSession() instead of getUser() here. getSession()
//      reads the JWT from the cookie locally and only hits the auth
//      server when the refresh token actually needs to roll over
//      (~hourly). getUser() validates with the auth server *every
//      request* and quickly trips Supabase's `over_request_rate_limit`
//      under any kind of refresh-heavy usage.
//
//      Pages and API routes still use getUser() through getCurrentUser()
//      in lib/supabase/server.ts — that's the security-sensitive
//      validation. The proxy only needs to know "is there a session"
//      for redirect logic.
//
// Next 16 renamed `middleware.ts` to `proxy.ts` (see node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md).
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

    // Cookie sniff: any cookie starting with `sb-` is a Supabase auth
    // cookie. No such cookie → no possible session → skip the whole
    // auth round-trip. The full @supabase/ssr client is only built
    // when there's something to validate.
    const hasAuthCookie = request.cookies.getAll().some((c) => c.name.startsWith("sb-"))

    if (!hasAuthCookie) {
        if (!isPublic) {
            const url = request.nextUrl.clone()
            url.pathname = "/login"
            url.searchParams.set("next", path)
            return NextResponse.redirect(url)
        }
        return response
    }

    const cookieDomain = process.env.NEXT_PUBLIC_AUTH_COOKIE_DOMAIN
    const sharedCookieOptions = cookieDomain
        ? { domain: cookieDomain, path: "/", sameSite: "lax" as const, secure: true }
        : undefined

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
                    toSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
                },
            },
        },
    )

    const { data: { session } } = await supabase.auth.getSession()
    const user = session?.user ?? null

    if (!user && !isPublic) {
        const url = request.nextUrl.clone()
        url.pathname = "/login"
        url.searchParams.set("next", path)
        return NextResponse.redirect(url)
    }
    if (user && (path === "/" || path === "/login")) {
        const url = request.nextUrl.clone()
        url.pathname = "/projects"
        return NextResponse.redirect(url)
    }

    return response
}

export const config = {
    // Skip everything that can't benefit from an auth-cookie refresh:
    // Next's internal asset paths and any URL with a file extension
    // (images, fonts, source maps, etc.). Each skipped request is one
    // fewer auth round-trip to Supabase. We deliberately keep /p/* and
    // /api/public-issues* in scope so an authenticated visitor's tokens
    // get refreshed when they hit invite-only links.
    matcher: [
        "/((?!_next/static|_next/image|_next/data|favicon\\.ico|robots\\.txt|sitemap\\.xml|.*\\..*).*)",
    ],
}
