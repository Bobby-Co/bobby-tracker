// Supabase adapter for TeamRunRegistry — counts and lists a team's in-flight runs.
//
// Spans BOTH planes, which is why it takes two clients. `projects` carries the
// team id and lives in the control plane; the run rows themselves (`issues`,
// `pull_request_analyses`) live in the team's regional data plane. A team's
// placement is per team (0064), so one data client covers all of its projects —
// the caller passes the one already bound for the request.
//
// Service-role on both sides. This is a billing control: it must see every
// project the TEAM owns, including ones the requesting member has no group grant
// for, or a burst spread across projects the caller cannot see would count as
// zero and pass.

import type { SupabaseClient } from "@supabase/supabase-js"
import { RepositoryError } from "@/lib/shared/kernel"
import { createSupabaseProjectsRepository } from "@/modules/projects"
import { ANALYSIS_STALE_AFTER_MS } from "../domain/AnalysisRun"
import type { ActiveRun, TeamRunRegistry } from "../ports/TeamRunRegistry"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any, any, any>

export class SupabaseTeamRunRegistry implements TeamRunRegistry {
    constructor(
        private readonly controlDb: AnyDb,
        private readonly dataDb: AnyDb,
    ) {}

    async countForTeam(teamId: string): Promise<number> {
        const projectIds = await this.projectIds(teamId)
        if (projectIds.length === 0) return 0
        const since = this.freshSince()

        // Two HEAD counts rather than one list: on the dispatch path only the
        // total matters, and a team mid-burst can have far more rows in flight
        // than the cap — counting them is cheap, transferring them is not.
        const [issues, prs] = await Promise.all([
            this.dataDb
                .from("issues")
                .select("id", { count: "exact", head: true })
                .in("project_id", projectIds)
                .eq("analysis_status", "analysing")
                .gte("analysis_started_at", since),
            this.dataDb
                .from("pull_request_analyses")
                .select("id", { count: "exact", head: true })
                .in("project_id", projectIds)
                .eq("status", "analysing")
                .gte("updated_at", since),
        ])
        if (issues.error) throw new RepositoryError(issues.error.message, { cause: issues.error })
        if (prs.error) throw new RepositoryError(prs.error.message, { cause: prs.error })
        return (issues.count ?? 0) + (prs.count ?? 0)
    }

    async listForTeam(teamId: string): Promise<ActiveRun[]> {
        const projectIds = await this.projectIds(teamId)
        if (projectIds.length === 0) return []
        const since = this.freshSince()

        const [issues, prs] = await Promise.all([
            this.dataDb
                .from("issues")
                .select("id, project_id")
                .in("project_id", projectIds)
                .eq("analysis_status", "analysing")
                .gte("analysis_started_at", since)
                .returns<{ id: string; project_id: string }[]>(),
            this.dataDb
                .from("pull_request_analyses")
                .select("id, project_id, pr_number")
                .in("project_id", projectIds)
                .eq("status", "analysing")
                .gte("updated_at", since)
                .returns<{ id: string; project_id: string; pr_number: number }[]>(),
        ])
        if (issues.error) throw new RepositoryError(issues.error.message, { cause: issues.error })
        if (prs.error) throw new RepositoryError(prs.error.message, { cause: prs.error })

        return [
            // The issue id IS the analyser task id for an issue run, and the
            // pull_request_analyses row id is the task id for a review — both by
            // construction at dispatch, not by a lookup here.
            ...(issues.data ?? []).map((r) => ({ kind: "issue" as const, taskId: r.id, projectId: r.project_id })),
            ...(prs.data ?? []).map((r) => ({
                kind: "pr" as const,
                taskId: r.id,
                projectId: r.project_id,
                prNumber: r.pr_number,
            })),
        ]
    }

    async listQueuedForTeam(teamId: string, limit: number): Promise<ActiveRun[]> {
        if (limit <= 0) return []
        const projectIds = await this.projectIds(teamId)
        if (projectIds.length === 0) return []

        // No recency filter, unlike the in-flight reads. A queued run has not
        // started, so there is no run to have gone missing — it is simply waiting,
        // and waiting a long time is what a full queue looks like rather than
        // evidence of a fault.
        //
        // Both kinds are read to `limit` and merged, then re-cut to `limit`: the
        // oldest `limit` overall could be all issues, all PRs, or any mix, and
        // asking for fewer of either risks missing the genuinely oldest.
        const [issues, prs] = await Promise.all([
            this.dataDb
                .from("issues")
                .select("id, project_id, updated_at")
                .in("project_id", projectIds)
                .eq("analysis_status", "queued")
                .order("updated_at", { ascending: true })
                .limit(limit)
                .returns<{ id: string; project_id: string; updated_at: string }[]>(),
            this.dataDb
                .from("pull_request_analyses")
                .select("id, project_id, pr_number, updated_at")
                .in("project_id", projectIds)
                .eq("status", "queued")
                .order("updated_at", { ascending: true })
                .limit(limit)
                .returns<{ id: string; project_id: string; pr_number: number; updated_at: string }[]>(),
        ])
        if (issues.error) throw new RepositoryError(issues.error.message, { cause: issues.error })
        if (prs.error) throw new RepositoryError(prs.error.message, { cause: prs.error })

        return [
            ...(issues.data ?? []).map((r) => ({
                run: { kind: "issue" as const, taskId: r.id, projectId: r.project_id },
                at: r.updated_at,
            })),
            ...(prs.data ?? []).map((r) => ({
                run: { kind: "pr" as const, taskId: r.id, projectId: r.project_id, prNumber: r.pr_number },
                at: r.updated_at,
            })),
        ]
            .sort((a, b) => a.at.localeCompare(b.at))
            .slice(0, limit)
            .map((e) => e.run)
    }

    private projectIds(teamId: string): Promise<string[]> {
        return createSupabaseProjectsRepository(this.controlDb).listIdsForTeam(teamId)
    }

    /** The cutoff below which a row claiming to be in flight is not believed.
     *  A null start time sorts out of a `gte` comparison automatically, which is
     *  the behaviour we want: no start time reads as abandoned. */
    private freshSince(): string {
        return new Date(Date.now() - ANALYSIS_STALE_AFTER_MS).toISOString()
    }
}

export function createSupabaseTeamRunRegistry(controlDb: AnyDb, dataDb: AnyDb): TeamRunRegistry {
    return new SupabaseTeamRunRegistry(controlDb, dataDb)
}
