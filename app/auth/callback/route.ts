import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

// Supabase OAuth callback. Exchanges the `code` query param for a session,
// then redirects to ?next=… (defaults to /projects).
export async function GET(request: Request) {
    const url = new URL(request.url)
    const code = url.searchParams.get("code")
    const next = url.searchParams.get("next") || "/projects"

    if (code) {
        const supabase = await createClient()
        const { error } = await supabase.auth.exchangeCodeForSession(code)
        if (error) {
            const errUrl = new URL("/login", url.origin)
            errUrl.searchParams.set("error", error.message)
            return NextResponse.redirect(errUrl)
        }
    }
    return NextResponse.redirect(new URL(next, url.origin))
}
