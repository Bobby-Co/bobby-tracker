// Public infrastructure — the Supabase adapter for ProjectPublicIntegrationRepository.
// The only place that touches project_public_integration. Bound to the caller's
// RLS-scoped client.

import type { SupabaseClient } from "@supabase/supabase-js"
import { RepositoryError } from "@/lib/shared/kernel"
import type { ProjectPublicIntegration } from "@/lib/shared/types"
import type {
    CoveringSession,
    IntegrationTab,
    ProjectPublicIntegrationRepository,
} from "../ports/ProjectPublicIntegrationRepository"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any, any, any>

export class SupabaseProjectPublicIntegrationRepository implements ProjectPublicIntegrationRepository {
    constructor(private readonly db: AnyDb) {}

    async findIntegration(projectId: string): Promise<ProjectPublicIntegration | null> {
        // Fail-safe (null on error), matching the route's default-to-disabled read.
        const { data } = await this.db
            .from("project_public_integration")
            .select("*")
            .eq("project_id", projectId)
            .maybeSingle<ProjectPublicIntegration>()
        return data ?? null
    }

    async setIntegration(projectId: string, enabled: boolean): Promise<ProjectPublicIntegration> {
        const { data, error } = await this.db
            .from("project_public_integration")
            .upsert({ project_id: projectId, enabled }, { onConflict: "project_id" })
            .select("*")
            .single<ProjectPublicIntegration>()
        if (error) throw new RepositoryError(error.message, { cause: error })
        return data
    }

    async findIntegrationTab(projectId: string): Promise<IntegrationTab> {
        // Both reads can fail independently when the public_* migrations haven't
        // landed; we tolerate that with a tableMissing flag rather than erroring.
        const [{ data: integration, error: intErr }, { data: links, error: linkErr }] = await Promise.all([
            this.db
                .from("project_public_integration")
                .select("*")
                .eq("project_id", projectId)
                .maybeSingle<ProjectPublicIntegration>(),
            this.db
                .from("public_session_projects")
                .select("session_id,public_sessions(id,name,enabled,submission_count)")
                .eq("project_id", projectId),
        ])
        const tableMissing = !!intErr || !!linkErr

        type LinkRow = { public_sessions: CoveringSession | CoveringSession[] | null }
        const sessions = ((links as unknown as LinkRow[]) ?? [])
            .map((r) => (Array.isArray(r.public_sessions) ? r.public_sessions[0] : r.public_sessions))
            .filter((s): s is CoveringSession => !!s)

        return { integration: integration ?? null, sessions, tableMissing }
    }
}

/** Composition seam: bind a ProjectPublicIntegrationRepository to a client. */
export function createSupabaseProjectPublicIntegrationRepository(db: AnyDb): ProjectPublicIntegrationRepository {
    return new SupabaseProjectPublicIntegrationRepository(db)
}
