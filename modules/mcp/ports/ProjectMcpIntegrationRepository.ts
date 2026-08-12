// Mcp module — the per-project MCP-exposure integration PORT
// (project_mcp_integration). RLS scopes rows to the project's owning team; the
// "only an admin may flip it" rule is the app layer's (the PATCH route), per the
// hybrid authz model in modules/README.md.
//
// The MCP server binds this port to a SERVICE-ROLE client (it resolves exposure
// without a browser session), so implementations must not assume a cookie-bound
// caller.

import type { ProjectMcpIntegration } from "../domain/ProjectMcpIntegration"

export interface ProjectMcpIntegrationRepository {
    /** The integration row for a project, or null when none exists. FAIL-SAFE
     *  (null on error) — callers default to a disabled shape. */
    findIntegration(projectId: string): Promise<ProjectMcpIntegration | null>

    /** Enable/disable the integration (UPSERT — the row may not exist yet);
     *  returns the resulting row. THROWS RepositoryError on failure. */
    setIntegration(projectId: string, enabled: boolean): Promise<ProjectMcpIntegration>

    /** Given candidate project ids, return the subset with enabled = true.
     *  An empty input resolves to an empty array without touching the DB.
     *  THROWS RepositoryError on a genuine query failure. */
    listEnabledProjectIds(projectIds: string[]): Promise<string[]>
}
