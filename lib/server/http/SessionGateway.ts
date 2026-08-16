// SessionGateway — the request's session boundary: who is calling, plus a unit of
// work bound to their RLS scope. ApiContext depends on THIS interface, not on the
// DB SDK; the concrete Supabase wiring lives only in the adapter below (and in
// RequestContext). Swapping the auth/store host is a new adapter + a one-line
// change in the composition seam.

import type { User } from "@supabase/supabase-js"
import { Supabase } from "@/lib/server/supabase"
import { RequestContext } from "./RequestContext"

export interface SessionGateway {
    /** The current authenticated user (cached per request), or null if anonymous. */
    currentUser(): Promise<User | null>
    /** Open a unit of work bound to the caller's RLS-scoped client. */
    openContext(): Promise<RequestContext>
}

class SupabaseSessionGateway implements SessionGateway {
    currentUser(): Promise<User | null> {
        return Supabase.currentUser()
    }
    async openContext(): Promise<RequestContext> {
        // SERVICE-ROLE, not the caller's RLS client. Authorization is decided by
        // AccessService before any query runs (see the guard + predicate tests),
        // so the database is no longer asked to re-derive it from a JWT.
        //
        // Two things follow. The obvious one: RLS no longer scopes these reads,
        // which is why every repository query must carry its own predicate. The
        // load-bearing one: a service-role client can be pointed at ANOTHER
        // REGION's database, while an RLS client is bound to a JWT only its own
        // Supabase project can validate. That is the whole reason this switch is
        // a prerequisite for the split.
        //
        // Only the CONTROL client is known here. The data plane stays unbound
        // until a guard resolves which team the request acts in, because that is
        // the earliest point at which the answer exists — the region is a
        // property of the team, and the team comes from the path, the header or
        // the cookie, none of which this layer sees.
        //
        // Deliberately not defaulting the data plane to this client. An unbound
        // data-plane read throws (see RequestContext), which turns "a route
        // forgot to bind" into a loud failure in development instead of a silent
        // read of the wrong region in production.
        return new RequestContext(Supabase.service())
    }
}

/** The app-wide SessionGateway (Supabase-backed today). */
export function getSessionGateway(): SessionGateway {
    return new SupabaseSessionGateway()
}
