import { Supabase } from "@/lib/server/supabase"

// GET /oauth/authorize — the advertised `authorization_endpoint` (RFC 8414).
//
// A ROUTE HANDLER rather than a page, so the signed-out bounce is a real HTTP
// redirect issued before any React runs. That matters because the ONE thing this
// hop must not lose is the query string: client_id, redirect_uri, code_challenge
// and state are the authorization request, and a user who comes back from login
// without them comes back to nothing. `/login?next=` therefore carries the raw
// search string verbatim.
//
// (The consent screen itself lives at /oauth/consent, outside app/(app) — it is
// an account-authorization screen, not a dashboard page, so it renders standalone
// under the root layout with no client-side auth guard in front of it.)
//
// This endpoint deliberately does NO protocol validation: /oauth/consent and
// POST /api/oauth/authorize each re-validate from the client registry, and
// duplicating those rules here would be a third place for them to drift.

export async function GET(request: Request) {
    const query = new URL(request.url).search // exact, including the leading "?"

    const user = await Supabase.currentUser()
    if (!user) {
        // Return through THIS endpoint after login, not straight to the consent
        // page: re-entering re-runs the session check, so the flow is idempotent
        // and a half-finished login can't drop someone on a page that will just
        // bounce them again.
        return found(`/login?next=${encodeURIComponent(`/oauth/authorize${query}`)}`)
    }
    return found(`/oauth/consent${query}`)
}

function found(location: string): Response {
    return new Response(null, {
        status: 302,
        // An authorization request is per-user and single-purpose; caching this
        // hop would serve one user's destination to the next.
        headers: { Location: location, "Cache-Control": "no-store" },
    })
}
