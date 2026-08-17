// Public module — the per-project public-submissions integration PORT
// (project_public_integration). RLS-scoped to the project's owner/team. Toggling
// it off also drops the project from covering sessions (done by the route via the
// PublicSessionAdminRepository).

import type { ProjectPublicIntegration } from "@/lib/shared/types"

/** A public session covering a project, for the project's Integrations tab. */
export interface CoveringSession {
    id: string
    name: string
    enabled: boolean
    submission_count: number
}

/** The Integrations-tab read: the integration row + covering sessions, plus a flag
 *  for when the public_* tables aren't migrated yet (the UI shows a hint). */
export interface IntegrationTab {
    integration: ProjectPublicIntegration | null
    sessions: CoveringSession[]
    tableMissing: boolean
}

export interface ProjectPublicIntegrationRepository {
    /** The integration row for a project, or null when none exists. FAIL-SAFE
     *  (null on error) — the route defaults to a disabled shape. */
    findIntegration(projectId: string): Promise<ProjectPublicIntegration | null>

    /** Enable/disable the integration (upsert); returns the row. THROWS. */
    setIntegration(projectId: string, enabled: boolean): Promise<ProjectPublicIntegration>

    /** The Integrations-tab data (integration + covering sessions + tableMissing).
     *  Tolerant of the tables being absent — never throws; sets tableMissing. */
    findIntegrationTab(projectId: string): Promise<IntegrationTab>
}
