// Analysis port — persistence for the pull_request_analyses tracking table. This
// is analysis-owned state (distinct from the vcs PR mirror): the per-PR analyser
// run row whose id doubles as the analyser task_id, its comment id, and the
// stored structured review. The PullRequestAnalysisService depends on this role
// instead of hitting the table inline (the golden-standard fix).

import type { PrAnalysis } from "@/lib/shared/types"

/** The idempotency/comment view of a PR's tracking row. */
export interface PullRequestAnalysisTracking {
    id: string
    status: string | null
    githubCommentId: number | null
}

/** The callback view of a tracking row, looked up by task id. */
export interface PullRequestAnalysisResultRow {
    id: string
    projectId: string
    prNumber: number
    githubCommentId: number | null
}

/** The fields upserted when a run is (re)started. */
export interface PullRequestAnalysisUpsert {
    projectId: string
    prNumber: number
    githubCommentId: number | null
    headSha: string | null
    status: string
}

export interface PullRequestAnalysisStore {
    /** The tracking row for a (project, prNumber), or null when none exists. */
    findTracking(projectId: string, prNumber: number): Promise<PullRequestAnalysisTracking | null>
    /** Upsert the tracking row (conflict on project_id,pr_number); returns its id. */
    upsertTracking(input: PullRequestAnalysisUpsert): Promise<{ id: string } | null>
    /** The tracking row by task id (its own id), for the terminal callback. */
    findResultRow(taskId: string): Promise<PullRequestAnalysisResultRow | null>
    /** Persist the terminal status + structured review (fires the pr_analysis_ready
     *  feed trigger). */
    saveResult(taskId: string, status: string, result: PrAnalysis | null): Promise<void>
}
