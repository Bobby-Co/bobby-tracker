// Projects module — PUBLIC CONTRACT. Other code imports the repository from
// here, never the module internals (ports/ or infrastructure/ directly). As the
// module grows this barrel exposes its commands, queries, and events.

export type { GithubSyncContext, ProjectsRepository } from "./ports/projects-repository"
export { createSupabaseProjectsRepository } from "./infrastructure/supabase-projects-repository"
