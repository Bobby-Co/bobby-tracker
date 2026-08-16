// Projects module — PUBLIC CONTRACT. Other code imports the repository from
// here, never the module internals (ports/ or infrastructure/ directly). As the
// module grows this barrel exposes its commands, queries, and events.

export type {
    GithubSyncContext,
    GithubSyncSettings,
    GithubSyncPatch,
    GithubLink,
    NewProject,
    ProjectPatch,
    ProjectCreateResult,
    ProjectSimilarity,
    ProjectsRepository,
} from "./ports/ProjectsRepository"
export { createSupabaseProjectsRepository } from "./infrastructure/SupabaseProjectsRepository"

// Per-project display settings (label icons + status colours)
export type { ProjectDisplayRepository } from "./ports/ProjectDisplayRepository"
export { createSupabaseProjectDisplayRepository } from "./infrastructure/SupabaseProjectDisplayRepository"

// ─── ProjectInsight aggregate — the tile-status derivation (which footer, how
//     long) as behaviour of the insight row: `ProjectInsight.of(row).status(now)` ─
export type { ProjectStatus, ProjectInsightState } from "./domain/ProjectInsight"
export { ProjectInsight } from "./domain/ProjectInsight"

// ─── Project aggregate — the GitHub-sync invariants (sync-ready, direction) ──
export type { ProjectSyncState, SyncDirection } from "./domain/Project"
export { Project } from "./domain/Project"

// ─── deleting a project across both planes ──────────────────────────────────
// The database no longer cascades into the regional tables (their FKs to
// `projects` cannot span two databases), so deletion is orchestrated in code.
export type { ProjectContentPurge, PurgeResult } from "./ports/ProjectContentPurge"
export { createSupabaseProjectContentPurge } from "./infrastructure/SupabaseProjectContentPurge"
export { ProjectDeletionService } from "./application/ProjectDeletionService"
