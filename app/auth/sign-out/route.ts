import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

// Honors an optional `next` form field so callers (e.g. the
// invite-only public page's "use a different account" button) can
// route the user back through /login → ?next=… and land them where
// they started. Falls back to /login when `next` is missing or
// off-domain (open-redirect guard).
export async function POST(request: Request) {
    const supabase = await createClient()
    await supabase.auth.signOut()

    let target = "/login"
    try {
        const form = await request.formData()
        const raw = form.get("next")
        if (typeof raw === "string" && raw.startsWith("/") && !raw.startsWith("//")) {
            target = raw
        }
    } catch { /* no body — keep default */ }

    return NextResponse.redirect(new URL(target, request.url), { status: 303 })
}
