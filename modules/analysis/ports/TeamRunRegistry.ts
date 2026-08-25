// What analysis work is a team running RIGHT NOW? — PORT.
//
// Deliberately derived from the existing run rows (`issues.analysis_status` and
// `pull_request_analyses.status`) rather than from a new ledger of its own. Those
// rows are already written before dispatch and cleared by the callback — they ARE
// the claim and the release — so a separate table would be a second source of
// truth that could disagree with the first, and would need its own leak handling
// on every path that can lose a callback.
//
// STALENESS IS THE READER'S PROBLEM. A run whose callback never arrives leaves a
// row claiming to be in flight forever, and there is no scheduler in this stack to
// come along and tidy it. So "in flight" means "marked running AND started
// recently" — the same rule, and the same window, that lets a wedged issue be
// retried (see domain/AnalysisRun.ts). Without that, one lost callback would
// permanently consume a slot of the team's concurrency and, at the Kit cap, lock
// the team out of analysis altogether.

/** Which kind of run — they cancel through different analyser endpoints. */
export type ActiveRunKind = "issue" | "pr"

export interface ActiveRun {
    kind: ActiveRunKind
    /** The analyser task id: the issue id for an issue run, the
     *  pull_request_analyses row id for a PR review. */
    taskId: string
    projectId: string
    /** PR runs only. Present because cancelling a review is addressed by
     *  (project, number) rather than by task id — the service re-reads the
     *  tracking row so it never cancels a run that has already moved on. */
    prNumber?: number
}

export interface TeamRunRegistry {
    /** How many runs the team currently has in flight. THROWS — a caller that
     *  cannot count must refuse to dispatch, not assume zero. */
    countForTeam(teamId: string): Promise<number>

    /** The same runs, identified well enough to cancel each one. Used by the
     *  exhaustion sweep. THROWS. */
    listForTeam(teamId: string): Promise<ActiveRun[]>

    /** Runs the team has QUEUED but not started, oldest first, capped at `limit`.
     *
     *  Oldest-first because the queue is the user's mental model of a queue: the
     *  third issue you asked about should not be overtaken by the fifth. `limit`
     *  is how many slots the drain has actually got — reading more would be rows
     *  fetched only to be ignored. THROWS. */
    listQueuedForTeam(teamId: string, limit: number): Promise<ActiveRun[]>
}
