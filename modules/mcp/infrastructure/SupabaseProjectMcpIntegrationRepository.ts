// Mcp infrastructure — the Supabase adapter for ProjectMcpIntegrationRepository.
// The only place that touches tracker.project_mcp_integration. Bound to whichever
// client the composition seam is handed: the caller's RLS-scoped client from a
// route (RequestContext), or the service-role client from the MCP server, which
// resolves exposure with no browser session.

import type { SupabaseClient } from "@supabase/supabase-js"
import { RepositoryError } from "@/lib/shared/kernel"
import type { ProjectMcpIntegration } from "../domain/ProjectMcpIntegration"
import type { ProjectMcpIntegrationRepository } from "../ports/ProjectMcpIntegrationRepository"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any, any, any>

const TABLE = "project_mcp_integration"
const COLS = "project_id, enabled, created_at, updated_at"

export class SupabaseProjectMcpIntegrationRepository implements ProjectMcpIntegrationRepository {
    constructor(private readonly db: AnyDb) {}

    async findIntegration(projectId: string): Promise<ProjectMcpIntegration | null> {
        // Fail-safe (null on error), matching the route's default-to-disabled
        // read: a project with no row — or a DB that hasn't had 0060 applied —
        // reads as "not exposed" rather than blowing up the Integrations tab.
        const { data } = await this.db
            .from(TABLE)
            .select(COLS)
            .eq("project_id", projectId)
            .maybeSingle<ProjectMcpIntegration>()
        return data ?? null
    }

    async setIntegration(projectId: string, enabled: boolean): Promise<ProjectMcpIntegration> {
        const { data, error } = await this.db
            .from(TABLE)
            .upsert({ project_id: projectId, enabled }, { onConflict: "project_id" })
            .select(COLS)
            .single<ProjectMcpIntegration>()
        if (error) throw new RepositoryError(error.message, { cause: error })
        return data
    }

    async listEnabledProjectIds(projectIds: string[]): Promise<string[]> {
        // No candidates → no query. `.in("project_id", [])` is a round-trip that
        // can only ever return zero rows.
        if (projectIds.length === 0) return []
        const { data, error } = await this.db
            .from(TABLE)
            .select("project_id")
            .in("project_id", projectIds)
            .eq("enabled", true)
        if (error) throw new RepositoryError(error.message, { cause: error })
        return ((data as { project_id: string }[] | null) ?? []).map((r) => r.project_id)
    }
}

/** Composition seam: bind a ProjectMcpIntegrationRepository to a Supabase client
 *  (the caller's RLS client, or the service-role client for the MCP server). */
export function createSupabaseProjectMcpIntegrationRepository(db: AnyDb): ProjectMcpIntegrationRepository {
    return new SupabaseProjectMcpIntegrationRepository(db)
}
