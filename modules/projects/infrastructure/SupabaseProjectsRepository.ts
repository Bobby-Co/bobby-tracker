// Projects module — Supabase adapter for ProjectsRepository. Infrastructure
// layer: the only place that touches the DB client. Swapping the persistence
// implementation (e.g. Supabase → a direct pg driver) means replacing this file,
// and nothing that depends on the port changes.

import type { SupabaseClient } from "@supabase/supabase-js"
import { RepositoryError } from "@/lib/shared/kernel"
import type { Project, ProjectInsight, ProjectWithInsight } from "@/lib/shared/types"
import { parseCellId, type CellId } from "@/modules/regions"
import type {
    AnalysisProjectContext,
    GithubLink,
    GithubSyncContext,
    GithubSyncPatch,
    GithubSyncSettings,
    NewProject,
    ProjectCreateResult,
    ProjectPatch,
    ProjectScope,
    ProjectSimilarity,
    ProjectsRepository,
} from "../ports/ProjectsRepository"

const GITHUB_SYNC_COLS =
    "id,user_id,repo_url,repo_full_name,github_installation_id,github_repo_id,github_sync_enabled,github_sync_direction,github_sync_deletes,provider,gitlab_project_id,gitlab_host"

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

    /** Resolved through the owning TEAM (0064): placement is per team, so a
     *  project is served by whatever cell its team lives in. Both tables are
     *  control-plane, so this stays a single embedded read rather than a
     *  cross-database join.
     *
     *  Narrows through parseCellId rather than casting — the column is text
     *  validated only for format, so a malformed value must read as "unknown" and
     *  fail routing loudly instead of being handed to a fetch. */
    async findCell(projectId: string): Promise<CellId | null> {
        const { data } = await this.db
            .from("projects")
            .select("teams(cell)")
            .eq("id", projectId)
            .maybeSingle<{ teams: { cell: string | null } | { cell: string | null }[] | null }>()
        // PostgREST returns an embedded to-one as an object, but as an array when
        // it can't prove the relationship is singular — accept both.
        const team = Array.isArray(data?.teams) ? data.teams[0] : data?.teams
        return parseCellId(team?.cell)
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

    async findFull(projectId: string): Promise<Project | null> {
        const { data, error } = await this.db.from("projects").select("*").eq("id", projectId).maybeSingle<Project>()
        if (error) throw new RepositoryError(error.message, { cause: error })
        return data ?? null
    }

    async findId(projectId: string): Promise<string | null> {
        const { data, error } = await this.db.from("projects").select("id").eq("id", projectId).maybeSingle<{ id: string }>()
        if (error) throw new RepositoryError(error.message, { cause: error })
        return data?.id ?? null
    }

    async listForTeam(teamId: string, scope: ProjectScope): Promise<Project[]> {
        let q = this.db.from("projects").select("*").eq("team_id", teamId).order("updated_at", { ascending: false })
        if (scope !== "all") q = q.in("id", scope)
        const { data, error } = await q.returns<Project[]>()
        if (error) throw new RepositoryError(error.message, { cause: error })
        return data ?? []
    }

    async listForTeamWithInsight(teamId: string, scope: ProjectScope): Promise<ProjectWithInsight[]> {
        let q = this.db
            .from("projects")
            .select("*, project_insight(*)")
            .eq("team_id", teamId)
            .order("updated_at", { ascending: false })
        if (scope !== "all") q = q.in("id", scope)
        const { data, error } = await q
        if (error) throw new RepositoryError(error.message, { cause: error })
        // PostgREST returns a one-to-one embed as an object (project_insight.project_id
        // is both PK and FK), but falls back to an array when it can't prove
        // uniqueness — normalise both.
        return ((data ?? []) as unknown as (Project & { project_insight: ProjectInsight | ProjectInsight[] | null })[]).map(
            (row) => {
                const { project_insight, ...project } = row
                const insight = Array.isArray(project_insight) ? project_insight[0] ?? null : project_insight ?? null
                return { ...project, insight }
            },
        )
    }

    async listRepoRefsForTeam(teamId: string): Promise<Pick<Project, "repo_url" | "repo_full_name">[]> {
        const { data, error } = await this.db
            .from("projects")
            .select("repo_url,repo_full_name")
            .eq("team_id", teamId)
            .returns<Pick<Project, "repo_url" | "repo_full_name">[]>()
        if (error) throw new RepositoryError(error.message, { cause: error })
        return data ?? []
    }

    async create(input: NewProject): Promise<ProjectCreateResult> {
        const { data, error } = await this.db.from("projects").insert(input).select("*").single<Project>()
        if (error) {
            if (error.code === "23505") {
                // Which unique constraint fired decides what the user can do about
                // it, so name it rather than reporting a generic duplicate. The
                // constraint name appears in the message; details carries it on
                // some PostgREST versions, so check both.
                const where = `${error.message} ${error.details ?? ""}`
                const globalHit =
                    where.includes("projects_github_repo_id_uniq") ||
                    where.includes("projects_gitlab_instance_project_uniq") ||
                    where.includes("projects_gitlab_project_id_uniq") // pre-0057 name
                return { ok: false, reason: globalHit ? "repo_linked_elsewhere" : "duplicate_in_team" }
            }
            throw new RepositoryError(error.message, { cause: error })
        }
        return { ok: true, project: data }
    }

    async update(projectId: string, patch: ProjectPatch): Promise<Project> {
        const { data, error } = await this.db.from("projects").update(patch).eq("id", projectId).select("*").single<Project>()
        if (error) throw new RepositoryError(error.message, { cause: error })
        return data
    }

    async delete(projectId: string): Promise<void> {
        const { error } = await this.db.from("projects").delete().eq("id", projectId)
        if (error) throw new RepositoryError(error.message, { cause: error })
    }

    async updateSyncSettings(projectId: string, patch: GithubSyncPatch): Promise<GithubSyncSettings> {
        const { data, error } = await this.db
            .from("projects")
            .update(patch)
            .eq("id", projectId)
            .select("id,github_installation_id,github_repo_id,github_sync_enabled,github_sync_direction,github_sync_deletes")
            .single<GithubSyncSettings>()
        if (error) throw new RepositoryError(error.message, { cause: error })
        return data
    }

    async linkGithub(projectId: string, installationId: number, repoId: number): Promise<GithubLink> {
        const { data, error } = await this.db
            .from("projects")
            .update({ github_installation_id: installationId, github_repo_id: repoId, github_sync_enabled: true })
            .eq("id", projectId)
            .select("id,github_installation_id,github_repo_id,github_sync_enabled")
            .single<GithubLink>()
        if (error) throw new RepositoryError(error.message, { cause: error })
        return data
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

    async listAllNames(teamId: string): Promise<{ id: string; name: string }[]> {
        // Best-effort ([] on error), matching the collection route's inline read.
        const { data } = await this.db
            .from("projects")
            .select("id,name")
            .eq("team_id", teamId)
            .order("name", { ascending: true })
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
