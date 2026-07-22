// Projects module — Supabase adapter for ProjectsRepository. Infrastructure
// layer: the only place that touches the DB client. Swapping the persistence
// implementation (e.g. Supabase → a direct pg driver) means replacing this file,
// and nothing that depends on the port changes.

import type { SupabaseClient } from "@supabase/supabase-js"
import { RepositoryError } from "@/lib/shared/kernel"
import type {
    AnalysisProjectContext,
    GithubSyncContext,
    ProjectSimilarity,
    ProjectsRepository,
} from "../ports/ProjectsRepository"

const GITHUB_SYNC_COLS =
    "id,user_id,repo_url,repo_full_name,github_installation_id,github_repo_id,github_sync_enabled,github_sync_direction,github_sync_deletes"

const ANALYSIS_COLS =
    "name,repo_url,repo_full_name,description,github_installation_id,github_repo_id,github_sync_enabled"

// The RLS client and the service-role client (createServiceClient) carry
// different schema generics ("public" vs "tracker"); accept any schema so both
// are assignable, mirroring the other repository adapters.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any, any, any>

/** The Supabase adapter for ProjectsRepository, bound to a specific client.
 *  Construct via the factory below. */
export class SupabaseProjectsRepository implements ProjectsRepository {
    constructor(private readonly db: AnyDb) {}

    async findGithubSyncContext(projectId: string): Promise<GithubSyncContext | null> {
        const { data } = await this.db
            .from("projects")
            .select(GITHUB_SYNC_COLS)
            .eq("id", projectId)
            .maybeSingle<GithubSyncContext>()
        return data ?? null
    }

    async findTeamId(projectId: string): Promise<string | null> {
        const { data } = await this.db
            .from("projects")
            .select("team_id")
            .eq("id", projectId)
            .maybeSingle<{ team_id: string | null }>()
        return data?.team_id ?? null
    }

    async findName(projectId: string): Promise<string | null> {
        const { data } = await this.db
            .from("projects")
            .select("name")
            .eq("id", projectId)
            .maybeSingle<{ name: string | null }>()
        return data?.name ?? null
    }

    async findPullContext(projectId: string): Promise<{ id: string; name: string; repo_url: string; repo_full_name: string | null } | null> {
        const { data, error } = await this.db
            .from("projects")
            .select("id,name,repo_url,repo_full_name")
            .eq("id", projectId)
            .maybeSingle<{ id: string; name: string; repo_url: string; repo_full_name: string | null }>()
        if (error) throw new RepositoryError(error.message, { cause: error })
        return data ?? null
    }

    async findAnalysisContext(projectId: string): Promise<AnalysisProjectContext | null> {
        const { data } = await this.db
            .from("projects")
            .select(ANALYSIS_COLS)
            .eq("id", projectId)
            .maybeSingle<AnalysisProjectContext>()
        return data ?? null
    }

    async findRepoRef(projectId: string): Promise<{ id: string; repo_url: string; repo_full_name: string | null } | null> {
        const { data, error } = await this.db
            .from("projects")
            .select("id,repo_url,repo_full_name")
            .eq("id", projectId)
            .maybeSingle<{ id: string; repo_url: string; repo_full_name: string | null }>()
        if (error) throw new RepositoryError(error.message, { cause: error })
        return data ?? null
    }

    async listAllNames(): Promise<{ id: string; name: string }[]> {
        // Best-effort ([] on error), matching the collection route's inline read.
        const { data } = await this.db.from("projects").select("id,name").order("name", { ascending: true })
        return ((data ?? []) as { id: string; name: string }[]).map((p) => ({ id: p.id, name: p.name }))
    }

    async findSimilarProjects(queryEmbedding: number[], projectIds: string[], limit: number): Promise<ProjectSimilarity[]> {
        const { data, error } = await this.db.rpc("find_similar_projects", {
            p_query_embedding: queryEmbedding,
            p_project_ids: projectIds,
            p_limit: limit,
        })
        if (error) throw new RepositoryError(error.message, { cause: error })
        return (data ?? []) as ProjectSimilarity[]
    }
}

/** Composition seam: bind a ProjectsRepository to a specific Supabase client. */
export function createSupabaseProjectsRepository(db: AnyDb): ProjectsRepository {
    return new SupabaseProjectsRepository(db)
}
