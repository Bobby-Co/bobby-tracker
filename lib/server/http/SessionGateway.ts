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
        return new RequestContext(await Supabase.rls())
    }
}

/** The app-wide SessionGateway (Supabase-backed today). */
export function getSessionGateway(): SessionGateway {
    return new SupabaseSessionGateway()
}
