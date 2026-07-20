// Projects module — Supabase adapter for ProjectsRepository. Infrastructure
// layer: the only place that touches the DB client. Swapping the persistence
// implementation (e.g. Supabase → a direct pg driver) means replacing this file,
// and nothing that depends on the port changes.

import type { SupabaseClient } from "@supabase/supabase-js"
import type { GithubSyncContext, ProjectsRepository } from "../ports/projects-repository"

const GITHUB_SYNC_COLS =
    "id,user_id,repo_url,repo_full_name,github_installation_id,github_repo_id,github_sync_enabled,github_sync_direction,github_sync_deletes"

// The RLS client and the service-role client (createServiceClient) carry
// different schema generics ("public" vs "tracker"); accept any schema so both
// are assignable, mirroring the other repository adapters.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any, any, any>

/** Build a ProjectsRepository bound to a specific Supabase client. Pass the
 *  request's RLS-scoped client so reads honour the caller's access; pass a
 *  service-role client only from a trusted context. */
export function createSupabaseProjectsRepository(db: AnyDb): ProjectsRepository {
    return {
        async findGithubSyncContext(projectId) {
            const { data } = await db
                .from("projects")
                .select(GITHUB_SYNC_COLS)
                .eq("id", projectId)
                .maybeSingle<GithubSyncContext>()
            return data ?? null
        },

        async findTeamId(projectId) {
            const { data } = await db
                .from("projects")
                .select("team_id")
                .eq("id", projectId)
                .maybeSingle<{ team_id: string | null }>()
            return data?.team_id ?? null
        },

        async findName(projectId) {
            const { data } = await db
                .from("projects")
                .select("name")
                .eq("id", projectId)
                .maybeSingle<{ name: string | null }>()
            return data?.name ?? null
        },
    }
}
