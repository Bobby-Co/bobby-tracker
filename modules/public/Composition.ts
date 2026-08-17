// Public module — composition root. Binds the PublicSessionService gate to its
// three repositories for a given Supabase client. The public routes pass a
// SERVICE-ROLE client: link-mode requests have no auth cookie, and the gate
// reads owner-only tables via RLS bypass while checking auth independently
// (cookie-bound) inside the current-visitor read.

import type { SupabaseClient } from "@supabase/supabase-js"

import { createSupabaseIssuesRepository } from "@/modules/issues"
import { createSupabaseTeamMembershipRepository } from "@/modules/teams"
import { createSupabasePublicSessionRepository } from "./infrastructure/SupabasePublicSessionRepository"
import { PublicSessionService } from "./infrastructure/PublicSessionService"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any, any, any>

/** The public-session access gate bound to `db` (pass the service-role client). */
export function getPublicSessionService(db: AnyDb): PublicSessionService {
    return new PublicSessionService(
        createSupabasePublicSessionRepository(db),
        createSupabaseIssuesRepository(db),
        createSupabaseTeamMembershipRepository(db),
    )
}
