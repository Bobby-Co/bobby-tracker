// Analysis module — repository PORT for the branches a project keeps indexed
// (tracker.project_branches). Mirrors ProjectAnalyserRepository, which owns the
// DEFAULT branch's row; this owns every other branch.
//
// In ports/ (not domain/), so — like ProjectAnalyserRepository — it may
// TYPE-reference the shared DB row type. No SDK/client here; persistence lives
// in ../infrastructure.

import type { ProjectBranch } from "@/lib/shared/types"

export interface ProjectBranchRepository {
    /** Every branch tracked for a project, oldest first. Empty for a project
     *  that has never tracked one — which is every project until someone does.
     *  Throws {@link RepositoryError} on a genuine query failure. */
    listByProject(projectId: string): Promise<ProjectBranch[]>

    /** One tracked branch, or null when it is not tracked. */
    find(projectId: string, branch: string): Promise<ProjectBranch | null>

    /** Start tracking a branch (status → pending). Idempotent: tracking a branch
     *  that is already tracked returns the existing row rather than resetting
     *  its status, so a double-click cannot knock a ready branch back to
     *  pending. */
    track(projectId: string, branch: string): Promise<ProjectBranch>

    /** Stop tracking a branch. The analyser's graph for it is dropped
     *  separately — this only forgets the intent to keep it. Returns false when
     *  the branch was not tracked. */
    untrack(projectId: string, branch: string): Promise<boolean>

    /** Flag an index run as started (status → indexing, clears last_error). */
    markIndexing(projectId: string, branch: string): Promise<void>

    /** Record a finished index (status → ready, stamps graph_id + sha + time). */
    markReady(projectId: string, branch: string, graphId: string, headSha: string | null): Promise<void>

    /** Record a failure (status → failed, records last_error). */
    markFailed(projectId: string, branch: string, message: string): Promise<void>
}
