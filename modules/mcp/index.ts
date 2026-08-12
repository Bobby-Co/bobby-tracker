// Mcp bounded context — PUBLIC CONTRACT (see modules/README.md).
//
// Owns the per-project "expose this project's knowledge base over MCP" flag
// (tracker.project_mcp_integration, migration 0060). Opt-in: a project with no
// row is not exposed. Everything that needs to know whether a project may be
// served to an MCP client asks through this barrel — nothing else queries the
// table.

// ─── domain: the integration value object + the opt-in default ───────────────
export type { ProjectMcpIntegration } from "./domain/ProjectMcpIntegration"
export { disabledMcpIntegration } from "./domain/ProjectMcpIntegration"

// ─── the exposure flag (project_mcp_integration) ─────────────────────────────
export type { ProjectMcpIntegrationRepository } from "./ports/ProjectMcpIntegrationRepository"
export { createSupabaseProjectMcpIntegrationRepository } from "./infrastructure/SupabaseProjectMcpIntegrationRepository"
