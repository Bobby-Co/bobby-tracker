// Analysis port — persistence for the pull_request_analyses tracking table. This
// is analysis-owned state (distinct from the vcs PR mirror): the per-PR analyser
// run row whose id doubles as the analyser task_id, its comment id, and the
// stored structured review. The PullRequestAnalysisService depends on this role
// instead of hitting the table inline (the golden-standard fix).

import type { PrAnalysis, ReviewRunProfile } from "@/lib/shared/types"

/** The idempotency/comment view of a PR's tracking row. */
export interface PullRequestAnalysisTracking {
    id: string
    status: string | null
    githubCommentId: number | null
    /** The head the last run covered — a finished run at the same head is not
     *  worth repeating (migration 0042). */
    headSha: string | null
}

/** The callback view of a tracking row, looked up by task id. */
export interface PullRequestAnalysisResultRow {
    id: string
    projectId: string
    prNumber: number
    githubCommentId: number | null
    /** What reviewed it (0079) — the callback renders it into the PR comment's
     *  footer, so the answer sits next to the review on GitHub too and not only
     *  in the app. Null on rows written before attribution existed. */
    reviewProfile: ReviewRunProfile | null
}

/** The fields upserted when a run is (re)started. */
export interface PullRequestAnalysisUpsert {
    projectId: string
    prNumber: number
    githubCommentId: number | null
    headSha: string | null
    status: string
    /** Which profile is about to review this PR (0079), or null for the default.
     *  Written at dispatch, with the run, so the record describes what ACTUALLY
     *  ran rather than what the project points at when somebody later looks. */
    reviewProfileId: string | null
    /** The same answer in full, including the compiled policy. Not optional: a
     *  new run always knows what it is running, and letting a caller omit it
     *  would quietly reintroduce the "null means we don't know" gap that only
     *  pre-0079 rows are entitled to. */
    reviewProfile: ReviewRunProfile
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
