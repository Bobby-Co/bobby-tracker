import { Supabase } from "@/lib/server/supabase"

// GET /oauth/authorize — the advertised `authorization_endpoint` (RFC 8414). A
// ROUTE HANDLER, not a page, and that choice is load-bearing rather than
// stylistic.
//
// THE PROBLEM IT SOLVES. The consent UI belongs inside the signed-in app shell,
// but `app/(app)/layout.tsx` is a CLIENT-side auth guard: for a signed-out
// visitor it renders a skeleton, never renders `children`, and bounces to
// `/login?next=${pathname}` — and `usePathname()` carries NO query string. For an
// authorization request that is fatal: client_id, redirect_uri, code_challenge
// and state would all be discarded, and the user would come back from login to a
// request that no longer means anything.
//
// A Server Component can't rescue that either. Its `redirect()` happens after the
// shell has already streamed, so Next emits it as a CLIENT-side redirect attached
// to the page segment — a segment the guard never renders, so it never fires.
//
// Route handlers ignore layouts entirely and answer with a real HTTP redirect
// before any React runs. So this endpoint owns the auth bounce, with the query
// string preserved verbatim, and hands off to /oauth/consent (which the guard
// then renders normally, because by that point there IS a session).
//
// It deliberately does NO protocol validation: /oauth/consent and
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
