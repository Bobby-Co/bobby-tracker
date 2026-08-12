// Mcp domain — the per-project MCP exposure flag (project_mcp_integration).
//
// A local value object rather than a `@/lib/shared/types` row import: the DIP
// boundary bans the generated DB types from domain/application, and the module
// owns this table, so the shape is declared here and the Supabase adapter maps
// onto it.
//
// Semantics: no row == not exposed. `enabled` is the whole decision — when true,
// this project's indexed knowledge base may be served to an MCP client.

export interface ProjectMcpIntegration {
    project_id: string
    enabled: boolean
    created_at: string | null
    updated_at: string | null
}

/** The shape a caller renders when no row exists yet (the opt-in default). */
export function disabledMcpIntegration(projectId: string): ProjectMcpIntegration {
    return { project_id: projectId, enabled: false, created_at: null, updated_at: null }
}
