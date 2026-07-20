// Projects module — Supabase adapter for ProjectsRepository. Infrastructure
// layer: the only place that touches the DB client. Swapping the persistence
// implementation (e.g. Supabase → a direct pg driver) means replacing this file,
// and nothing that depends on the port changes.

import type { SupabaseClient } from "@supabase/supabase-js"
import type { GithubSyncContext, ProjectsRepository } from "../ports/projects-repository"

const GITHUB_SYNC_COLS =
    "id,user_id,repo_url,repo_full_name,github_installation_id,github_repo_id,github_sync_enabled,github_sync_direction,github_sync_deletes"

/** Build a ProjectsRepository bound to a specific Supabase client. Pass the
 *  request's RLS-scoped client so reads honour the caller's access; pass a
 *  service-role client only from a trusted context. */
export function createSupabaseProjectsRepository(db: SupabaseClient): ProjectsRepository {
    return {
        async findGithubSyncContext(projectId) {
            const { data } = await db
                .from("projects")
                .select(GITHUB_SYNC_COLS)
                .eq("id", projectId)
                .maybeSingle<GithubSyncContext>()
            return data ?? null
        },
    }
}
