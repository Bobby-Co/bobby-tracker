// Analysis module — repository PORT for the per-project analyser row
// (tracker.project_analyser: the analyser's enabled/status/graph_id/health state
// for a project). The application/interface layers depend on this interface; the
// Supabase implementation lives in ../infrastructure. Part of the modular-DDD
// Phase 1 work (see modules/README.md) — moving inline .from() behind repositories.
//
// This file is in ports/ (not domain/ or application/), so — like
// modules/projects/ports/projects-repository.ts — it may TYPE-reference the shared
// DB row type. No SDK/client is imported here; persistence stays in infrastructure.

import type { ProjectAnalyser } from "@/lib/supabase/types"

/** The readiness-gate projection: the columns isAnalyserReady() needs. Kept as a
 *  narrow select so hot gate paths don't pull the full row (incl. the health
 *  report JSONB). */
export type AnalyserReadinessRow = Pick<ProjectAnalyser, "enabled" | "status" | "graph_id">

export interface ProjectAnalyserRepository {
    /** The full analyser row for a project, or null when none exists, the query
     *  fails, or it isn't visible to the caller (the injected client carries the
     *  caller's RLS scope). */
    findByProjectId(projectId: string): Promise<ProjectAnalyser | null>

    /** Just the readiness-gate columns (enabled/status/graph_id) — pair with
     *  isAnalyserReady(). Same null semantics as findByProjectId. */
    findReadiness(projectId: string): Promise<AnalyserReadinessRow | null>
}
