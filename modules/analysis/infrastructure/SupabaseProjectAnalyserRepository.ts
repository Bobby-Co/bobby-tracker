// Analysis module — Supabase adapter for ProjectAnalyserRepository. Infrastructure
// layer: the only place that touches the DB client for the project_analyser table.
// Swapping persistence means replacing this file; nothing that depends on the port
// changes.
//
// Null-on-error semantics (mirrors modules/projects' repository): a missing row —
// or a failed query — resolves to null. Only repoint call sites whose current
// behaviour treats "no readable row" uniformly; sites that surface a distinct
// db_error 500 must keep their inline query until the port grows an error channel.

import type { SupabaseClient } from "@supabase/supabase-js"
import { RepositoryError } from "@/lib/kernel"
import type { ProjectAnalyser } from "@/lib/supabase/types"
import type { AnalyserReadinessRow, ProjectAnalyserRepository } from "../ports/ProjectAnalyserRepository"

const READINESS_COLS = "enabled,status,graph_id"

// The RLS client and the service-role client (createServiceClient) carry
// different schema generics ("public" vs "tracker"); accept any schema so both
// are assignable, mirroring modules/notifications/composition.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any, any, any>

/** Build a ProjectAnalyserRepository bound to a specific Supabase client. Pass the
 *  request's RLS-scoped client so reads honour the caller's access; pass a
 *  service-role client only from a trusted context. */
/** The Supabase adapter for ProjectAnalyserRepository, bound to a specific client.
 *  Construct via the factory below. */
export class SupabaseProjectAnalyserRepository implements ProjectAnalyserRepository {
    constructor(private readonly db: AnyDb) {}

    async findByProjectId(projectId: string): Promise<ProjectAnalyser | null> {
        const { data, error } = await this.db
            .from("project_analyser")
            .select("*")
            .eq("project_id", projectId)
            .maybeSingle<ProjectAnalyser>()
        if (error) throw new RepositoryError(`project_analyser lookup failed: ${error.message}`, { cause: error })
        return data ?? null
    }

    async findReadiness(projectId: string): Promise<AnalyserReadinessRow | null> {
        const { data, error } = await this.db
            .from("project_analyser")
            .select(READINESS_COLS)
            .eq("project_id", projectId)
            .maybeSingle<AnalyserReadinessRow>()
        if (error) throw new RepositoryError(`project_analyser readiness lookup failed: ${error.message}`, { cause: error })
        return data ?? null
    }

    async findGraphId(projectId: string): Promise<string | null> {
        const { data, error } = await this.db
            .from("project_analyser")
            .select("graph_id")
            .eq("project_id", projectId)
            .maybeSingle<Pick<ProjectAnalyser, "graph_id">>()
        if (error) throw new RepositoryError(`project_analyser graph_id lookup failed: ${error.message}`, { cause: error })
        return data?.graph_id ?? null
    }

    async saveHealthReport(projectId: string, report: unknown, checkedAt: string): Promise<void> {
        const { error } = await this.db
            .from("project_analyser")
            .update({ last_health_report: report, last_health_check_at: checkedAt })
            .eq("project_id", projectId)
        if (error) throw new RepositoryError(`project_analyser health-report write failed: ${error.message}`, { cause: error })
    }

    async enable(projectId: string): Promise<ProjectAnalyser> {
        const { data, error } = await this.db
            .from("project_analyser")
            .upsert({ project_id: projectId, enabled: true, status: "pending" }, { onConflict: "project_id" })
            .select("*")
            .single<ProjectAnalyser>()
        if (error) throw new RepositoryError(`project_analyser enable failed: ${error.message}`, { cause: error })
        return data
    }

    async disable(projectId: string): Promise<ProjectAnalyser> {
        const { data, error } = await this.db
            .from("project_analyser")
            .upsert({ project_id: projectId, enabled: false, status: "disabled" }, { onConflict: "project_id" })
            .select("*")
            .single<ProjectAnalyser>()
        if (error) throw new RepositoryError(`project_analyser disable failed: ${error.message}`, { cause: error })
        return data
    }

    async markIndexing(projectId: string, progress: unknown): Promise<void> {
        const { error } = await this.db
            .from("project_analyser")
            .upsert(
                { project_id: projectId, enabled: true, status: "indexing", last_error: null, progress },
                { onConflict: "project_id" },
            )
        if (error) throw new RepositoryError(`project_analyser mark-indexing failed: ${error.message}`, { cause: error })
    }

    async markFailed(projectId: string, message: string): Promise<void> {
        const { error } = await this.db
            .from("project_analyser")
            .upsert(
                { project_id: projectId, enabled: true, status: "failed", last_error: message, progress: {} },
                { onConflict: "project_id" },
            )
        if (error) throw new RepositoryError(`project_analyser mark-failed failed: ${error.message}`, { cause: error })
    }
}

/** Composition seam: bind a ProjectAnalyserRepository to a specific Supabase
 *  client. Pass the request's RLS-scoped client so reads honour the caller's
 *  access; pass a service-role client only from a trusted context. */
export function createSupabaseProjectAnalyserRepository(db: AnyDb): ProjectAnalyserRepository {
    return new SupabaseProjectAnalyserRepository(db)
}
