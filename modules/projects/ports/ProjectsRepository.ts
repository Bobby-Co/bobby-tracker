// Projects module — repository PORT. The application/interface layers depend on
// this interface; the Supabase implementation lives in ../infrastructure. Part
// of the modular-DDD refactor (see modules/README.md).
//
// This file is in ports/ (not domain/ or application/), so it may reference the
// shared DB row type — a pragmatic, TYPE-ONLY coupling. No SDK or client is
// imported here; concrete persistence stays in infrastructure.

import type { Project } from "@/lib/shared/types"

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
>

/** The project fields the analysis flow reads — name/description for the prompt +
 *  comment, plus the GitHub-link + sync-enabled gate. */
export type AnalysisProjectContext = Pick<
    Project,
    "name" | "repo_url" | "repo_full_name" | "description" | "github_installation_id" | "github_repo_id" | "github_sync_enabled"
>

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

    /** Analysis-flow project context (name/description + GitHub-link gate), or
     *  null when absent / not visible. */
    findAnalysisContext(projectId: string): Promise<AnalysisProjectContext | null>

    /** repo_url + repo_full_name for GitHub-link building. THROWS RepositoryError
     *  on a genuine query failure — unlike the null-swallowing reads above — so a
     *  caller that must distinguish "store broken" (500) from "absent" (404) can.
     *  Returns null only for a genuinely absent row. */
    findRepoRef(projectId: string): Promise<Pick<Project, "repo_url" | "repo_full_name"> | null>
}
