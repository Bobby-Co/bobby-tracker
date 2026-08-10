// Projects module — repository PORT. The application/interface layers depend on
// this interface; the Supabase implementation lives in ../infrastructure. Part
// of the modular-DDD refactor (see modules/README.md).
//
// This file is in ports/ (not domain/ or application/), so it may reference the
// shared DB row type — a pragmatic, TYPE-ONLY coupling. No SDK or client is
// imported here; concrete persistence stays in infrastructure.

import type { Project, ProjectWithInsight } from "@/lib/shared/types"

/** Which projects a team list is scoped to: every team project ("all") or a
 *  specific set of ids (the member's group-granted projects). */
export type ProjectScope = "all" | string[]

/** The project fields needed to mirror a change to GitHub. Previously a
 *  hand-copied 8-column `select(...)` + `Pick<Project, …>` repeated verbatim
 *  across the issue routes; now defined in exactly one place. */
export type GithubSyncContext = Pick<
    Project,
    | "id"
    | "user_id"
    | "repo_url"
    | "repo_full_name"
    | "github_installation_id"
    | "github_repo_id"
    | "github_sync_enabled"
    | "github_sync_direction"
    | "github_sync_deletes"
    | "provider"
    | "gitlab_project_id"
    | "gitlab_host"
>

/** The project fields the analysis flow reads — name/description for the prompt +
 *  comment, plus the GitHub-link + sync-enabled gate. */
export type AnalysisProjectContext = Pick<
    Project,
    "name" | "repo_url" | "repo_full_name" | "description" | "github_installation_id" | "github_repo_id" | "github_sync_enabled"
>

/** The mutable fields of a project (the settings PATCH). */
export type ProjectPatch = Partial<Pick<Project, "name" | "description" | "repo_url" | "auto_index_on_push" | "icon_name">>

/** The fields to create a project. */
export interface NewProject {
    team_id: string
    user_id: string
    name: string
    repo_url: string
    repo_full_name: string | null
    description: string | null
    // VCS provider fields. Omitted for GitHub (the DB defaults provider to
    // 'github'); set for a GitLab-sourced project so it's correctly tagged and
    // routable. gitlab_host + gitlab_project_id together identify the remote
    // (project ids are only unique within an instance).
    provider?: string
    gitlab_project_id?: number | null
    gitlab_host?: string | null
}

/** The GitHub-sync settings projection the sync-settings route returns. */
export type GithubSyncSettings = Pick<
    Project,
    "id" | "github_installation_id" | "github_repo_id" | "github_sync_enabled" | "github_sync_direction" | "github_sync_deletes"
>

/** The github_sync_* patch (any subset). */
export interface GithubSyncPatch {
    github_sync_enabled?: boolean
    github_sync_direction?: string
    github_sync_deletes?: boolean
}

/** The link projection the connect/link routes return. */
export type GithubLink = Pick<Project, "id" | "github_installation_id" | "github_repo_id" | "github_sync_enabled">

/** Create outcome: the created project, or "duplicate" when the team already has
 *  the repo (unique(team_id, repo_url) 23505) — the route maps that to a 409. */
export type ProjectCreateResult = { ok: true; project: Project } | { ok: false; reason: "duplicate" }

/** One row of the find_similar_projects routing RPC (AI compose ranking). */
export interface ProjectSimilarity {
    project_id: string
    similarity: number
    main_sim: number | null
    layer_sim: number | null
    feature_sim: number | null
}

export interface ProjectsRepository {
    /** GitHub-sync fields for one project, or null when it isn't found / isn't
     *  visible to the caller (the injected client carries the caller's RLS
     *  scope). */
    findGithubSyncContext(projectId: string): Promise<GithubSyncContext | null>

    /** The owning team id for a project, or null when absent / not visible.
     *  Used by cross-context reactions (e.g. notification fan-out) that must
     *  resolve recipients without querying the projects table directly. */
    findTeamId(projectId: string): Promise<string | null>

    /** The project's display name, or null when absent / not visible. */
    findName(projectId: string): Promise<string | null>

    /** id + name + repo ref for the PR-detail page. THROWS RepositoryError on a
     *  query failure (the route surfaces a 500 vs a 404). */
    findPullContext(projectId: string): Promise<Pick<Project, "id" | "name" | "repo_url" | "repo_full_name"> | null>

    /** The full project row, or null when absent. THROWS on a query failure. */
    findFull(projectId: string): Promise<Project | null>

    /** Just the project's id (an existence/ownership probe), or null when absent.
     *  THROWS on a query failure. */
    findId(projectId: string): Promise<string | null>

    /** The team's projects (scoped to `scope`), newest first. THROWS. */
    listForTeam(teamId: string, scope: ProjectScope): Promise<Project[]>

    /** As listForTeam, each project with its insight row embedded (0047),
     *  normalised from the PostgREST embed. THROWS. */
    listForTeamWithInsight(teamId: string, scope: ProjectScope): Promise<ProjectWithInsight[]>

    /** repo_url + repo_full_name for every project in a team — the create-time
     *  duplicate check. THROWS on a query failure. */
    listRepoRefsForTeam(teamId: string): Promise<Pick<Project, "repo_url" | "repo_full_name">[]>

    /** Insert a project ("duplicate" when the team already has the repo, 23505).
     *  THROWS RepositoryError on any other failure. */
    create(input: NewProject): Promise<ProjectCreateResult>

    /** Apply a validated settings patch and return the updated row. THROWS. */
    update(projectId: string, patch: ProjectPatch): Promise<Project>

    /** Delete a project (FK cascades wipe its children). THROWS. */
    delete(projectId: string): Promise<void>

    /** Apply a github_sync_* patch and return the sync-settings projection. THROWS. */
    updateSyncSettings(projectId: string, patch: GithubSyncPatch): Promise<GithubSyncSettings>

    /** Link a GitHub installation + repo id and enable sync; returns the link
     *  projection. THROWS on a query failure. */
    linkGithub(projectId: string, installationId: number, repoId: number): Promise<GithubLink>

    /** Analysis-flow project context (name/description + GitHub-link gate), or
     *  null when absent / not visible. */
    findAnalysisContext(projectId: string): Promise<AnalysisProjectContext | null>

    /** repo_url + repo_full_name for GitHub-link building. THROWS RepositoryError
     *  on a genuine query failure — unlike the null-swallowing reads above — so a
     *  caller that must distinguish "store broken" (500) from "absent" (404) can.
     *  Returns null only for a genuinely absent row. */
    findRepoRef(projectId: string): Promise<Pick<Project, "repo_url" | "repo_full_name"> | null>

    /** id+name of every project the caller can see, alphabetical — the collection
     *  settings "add member" picker. FAIL-SAFE ([] on error). */
    listAllNames(): Promise<{ id: string; name: string }[]>

    /** Weighted project-similarity ranking (find_similar_projects RPC) for AI
     *  routing over a fixed set of candidate projects. THROWS RepositoryError. */
    findSimilarProjects(queryEmbedding: number[], projectIds: string[], limit: number): Promise<ProjectSimilarity[]>
}
