// Access module — composition root. Constructs the AccessService with concrete
// Supabase-backed repositories from the Teams and Projects contracts. Callers pass
// the client that carries the right scope: the caller's RLS client for a
// request-time authz decision, or a service-role client for a server-to-server
// context. A future host or store swaps only the factories referenced here.

import type { SupabaseClient } from "@supabase/supabase-js"
import { createSupabaseProjectsRepository } from "@/modules/projects"
import { createSupabaseTeamMembershipRepository } from "@/modules/teams"
import { AccessService } from "./application/AccessService"

// The RLS client and the service-role client carry different schema generics
// ("public" vs "tracker"); accept any schema so both are assignable.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any, any, any>

/** Bind an AccessService to a specific Supabase client. */
export function getAccessService(db: AnyDb): AccessService {
    return new AccessService(
        createSupabaseProjectsRepository(db),
        createSupabaseTeamMembershipRepository(db),
    )
}
