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

/** Bind an AccessService to Supabase clients.
 *
 *  Two handles because this service is the one place authorization spans both
 *  planes: it reads `projects.team_id` on the DATA side and `team_members` on the
 *  CONTROL side. They are separate single-table reads — never a join — which is
 *  what makes the split survivable; see lib/server/http/RequestContext.ts.
 *
 *  `dataDb` defaults to `controlDb`, so every existing single-client call site
 *  (service-role contexts, MCP, tests) keeps working unchanged. */
export function getAccessService(controlDb: AnyDb, dataDb: AnyDb = controlDb): AccessService {
    return new AccessService(
        createSupabaseProjectsRepository(dataDb),
        createSupabaseTeamMembershipRepository(controlDb),
    )
}
