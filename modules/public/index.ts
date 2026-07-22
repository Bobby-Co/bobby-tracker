// Public bounded context — PUBLIC CONTRACT (see modules/README.md).
// The anonymous /p/<token> reporting surface: session/invite resolution + access
// gates, plus the reporter-grouping read-model. Browser-only reporter-identity
// storage lives with the client, in components/public/public-profile.ts.

// Reporter read-model (domain)
export type { PublicListedIssue, PublicParentRow, PublicReporterGroup } from "./domain/PublicReporter"
export { PublicReporter } from "./domain/PublicReporter"

// PublicSession aggregate — open-window + access rules + the public-issue label
export type { PublicSessionState } from "./domain/PublicSession"
export { PublicSession, PUBLIC_ISSUE_LABEL } from "./domain/PublicSession"

// Session-gate persistence (port + Supabase adapter)
export type { PublicSessionRepository, PublicSessionRow, IssueReporter } from "./ports/PublicSessionRepository"
export { createSupabasePublicSessionRepository } from "./infrastructure/SupabasePublicSessionRepository"

// Owner-side session administration (the /sessions management surface)
export type {
    PublicSessionAdminRepository,
    NewPublicSession,
    PublicSessionPatch,
    SessionProjectResult,
} from "./ports/PublicSessionAdminRepository"
export { createSupabasePublicSessionAdminRepository } from "./infrastructure/SupabasePublicSessionAdminRepository"

// Per-project public-submissions integration (project_public_integration)
export type {
    ProjectPublicIntegrationRepository,
    IntegrationTab,
    CoveringSession,
} from "./ports/ProjectPublicIntegrationRepository"
export { createSupabaseProjectPublicIntegrationRepository } from "./infrastructure/SupabaseProjectPublicIntegrationRepository"

// The access gate (service) — resolve / fetchPublicIssue / require*; obtained via
// getPublicSessionService(db). Plus the standalone current-visitor read.
export type { ResolvedPublicSession, InviteCheck } from "./infrastructure/PublicSessionService"
export { PublicSessionService } from "./infrastructure/PublicSessionService"
export { getPublicSessionService } from "./Composition"
export type { PublicVisitor } from "./infrastructure/CurrentVisitor"
export { CurrentVisitor } from "./infrastructure/CurrentVisitor"
