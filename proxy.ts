import { NextResponse, type NextRequest } from "next/server"
import { createServerClient, type CookieOptions } from "@supabase/ssr"

// Refreshes the Supabase auth cookies on every request and gates the
// /app/* routes behind authentication. /login, /auth/* and static
// assets are public.
//
// Next 16 renamed `middleware.ts` to `proxy.ts` (see node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md).
export async function proxy(request: NextRequest) {
    let response = NextResponse.next({ request })

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

    const { data: { user } } = await supabase.auth.getUser()

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
    // fewer auth.getUser() round-trip to Supabase. We deliberately
    // keep /p/* and /api/public-issues* in scope so an authenticated
    // visitor's tokens get refreshed when they hit invite-only links.
    matcher: [
        "/((?!_next/static|_next/image|_next/data|favicon\\.ico|robots\\.txt|sitemap\\.xml|.*\\..*).*)",
    ],
}
