// Analysis module — Supabase adapter for ProjectBranchRepository. Infrastructure
// layer: the only place that touches the DB client for the project_branches
// table. Mirrors SupabaseProjectAnalyserRepository, which owns the default
// branch's row.

import type { SupabaseClient } from "@supabase/supabase-js"
import { RepositoryError } from "@/lib/shared/kernel"
import type { ProjectBranch } from "@/lib/shared/types"
import type { ProjectBranchRepository } from "../ports/ProjectBranchRepository"

// The RLS client and the service-role client carry different schema generics;
// accept any schema so both are assignable (see the analyser repository).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any, any, any>

export class SupabaseProjectBranchRepository implements ProjectBranchRepository {
    constructor(private readonly db: AnyDb) {}

    async listByProject(projectId: string): Promise<ProjectBranch[]> {
        const { data, error } = await this.db
            .from("project_branches")
            .select("*")
            .eq("project_id", projectId)
            .order("created_at", { ascending: true })
        if (error) throw new RepositoryError(`project_branches list failed: ${error.message}`, { cause: error })
        return (data ?? []) as ProjectBranch[]
    }

    async find(projectId: string, branch: string): Promise<ProjectBranch | null> {
        const { data, error } = await this.db
            .from("project_branches")
            .select("*")
            .eq("project_id", projectId)
            .eq("branch", branch)
            .maybeSingle<ProjectBranch>()
        if (error) throw new RepositoryError(`project_branches lookup failed: ${error.message}`, { cause: error })
        return data ?? null
    }

    // Read-then-insert rather than an upsert, because an upsert would reset a
    // READY branch's status to pending every time someone clicked track again —
    // making the branch briefly unqueryable for no reason. The unique constraint
    // is still the authority: a race that loses on insert re-reads and returns
    // the winner's row.
    async track(projectId: string, branch: string): Promise<ProjectBranch> {
        const existing = await this.find(projectId, branch)
        if (existing) return existing

        const { data, error } = await this.db
            .from("project_branches")
            .insert({ project_id: projectId, branch, status: "pending" })
            .select("*")
            .maybeSingle<ProjectBranch>()
        if (error) {
            // 23505 — someone else inserted the same branch between our read and
            // our write. Their row is as good as ours would have been.
            const raced = await this.find(projectId, branch)
            if (raced) return raced
            throw new RepositoryError(`project_branches track failed: ${error.message}`, { cause: error })
        }
        if (!data) throw new RepositoryError("project_branches track returned no row")
        return data
    }

    async untrack(projectId: string, branch: string): Promise<boolean> {
        const { data, error } = await this.db
            .from("project_branches")
            .delete()
            .eq("project_id", projectId)
            .eq("branch", branch)
            .select("id")
        if (error) throw new RepositoryError(`project_branches untrack failed: ${error.message}`, { cause: error })
        return (data ?? []).length > 0
    }

    async markIndexing(projectId: string, branch: string): Promise<void> {
        const { error } = await this.db
            .from("project_branches")
            .update({ status: "indexing", last_error: null })
            .eq("project_id", projectId)
            .eq("branch", branch)
        if (error) throw new RepositoryError(`project_branches mark-indexing failed: ${error.message}`, { cause: error })
    }

    async markReady(projectId: string, branch: string, graphId: string, headSha: string | null): Promise<void> {
        const { error } = await this.db
            .from("project_branches")
            .update({
                status: "ready",
                graph_id: graphId,
                last_indexed_sha: headSha,
                last_indexed_at: new Date().toISOString(),
                last_error: null,
            })
            .eq("project_id", projectId)
            .eq("branch", branch)
        if (error) throw new RepositoryError(`project_branches mark-ready failed: ${error.message}`, { cause: error })
    }

    async markFailed(projectId: string, branch: string, message: string): Promise<void> {
        const { error } = await this.db
            .from("project_branches")
            .update({ status: "failed", last_error: message })
            .eq("project_id", projectId)
            .eq("branch", branch)
        if (error) throw new RepositoryError(`project_branches mark-failed failed: ${error.message}`, { cause: error })
    }
}

/** Composition seam: bind a ProjectBranchRepository to a specific Supabase
 *  client. Pass the request's RLS-scoped client so reads honour the caller's
 *  access; pass a service-role client only from a trusted context. */
export function createSupabaseProjectBranchRepository(db: AnyDb): ProjectBranchRepository {
    return new SupabaseProjectBranchRepository(db)
}
