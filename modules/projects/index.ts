// Projects module — PUBLIC CONTRACT. Other code imports the repository from
// here, never the module internals (ports/ or infrastructure/ directly). As the
// module grows this barrel exposes its commands, queries, and events.

export type { GithubSyncContext, ProjectsRepository } from "./ports/ProjectsRepository"
export { createSupabaseProjectsRepository } from "./infrastructure/SupabaseProjectsRepository"

// ─── project-status policy (which footer a project tile shows) ───────────────
export type { ProjectStatus, ProjectInsightView } from "./domain/PickStatus"
export { pickStatus, URGENT_WINDOW_MS, PR_WINDOW_MS } from "./domain/PickStatus"

// ─── Project aggregate — the GitHub-sync invariants (sync-ready, direction) ──
export type { ProjectSyncState, SyncDirection } from "./domain/Project"
export { Project } from "./domain/Project"
