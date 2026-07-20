// Projects module — PUBLIC CONTRACT. Other code imports the repository from
// here, never the module internals (ports/ or infrastructure/ directly). As the
// module grows this barrel exposes its commands, queries, and events.

export type { GithubSyncContext, ProjectsRepository } from "./ports/projects-repository"
export { createSupabaseProjectsRepository } from "./infrastructure/supabase-projects-repository"

// ─── project-status policy (which footer a project tile shows) ───────────────
export type { ProjectStatus, ProjectInsightView } from "./domain/pick-status"
export { pickStatus, URGENT_WINDOW_MS, PR_WINDOW_MS } from "./domain/pick-status"
