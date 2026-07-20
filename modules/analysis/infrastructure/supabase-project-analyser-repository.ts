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
import type { ProjectAnalyser } from "@/lib/supabase/types"
import type { AnalyserReadinessRow, ProjectAnalyserRepository } from "../ports/project-analyser-repository"

const READINESS_COLS = "enabled,status,graph_id"

// The RLS client and the service-role client (createServiceClient) carry
// different schema generics ("public" vs "tracker"); accept any schema so both
// are assignable, mirroring modules/notifications/composition.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any, any, any>

/** Build a ProjectAnalyserRepository bound to a specific Supabase client. Pass the
 *  request's RLS-scoped client so reads honour the caller's access; pass a
 *  service-role client only from a trusted context. */
export function createSupabaseProjectAnalyserRepository(db: AnyDb): ProjectAnalyserRepository {
    return {
        async findByProjectId(projectId) {
            const { data } = await db
                .from("project_analyser")
                .select("*")
                .eq("project_id", projectId)
                .maybeSingle<ProjectAnalyser>()
            return data ?? null
        },
        async findReadiness(projectId) {
            const { data } = await db
                .from("project_analyser")
                .select(READINESS_COLS)
                .eq("project_id", projectId)
                .maybeSingle<AnalyserReadinessRow>()
            return data ?? null
        },
    }
}
