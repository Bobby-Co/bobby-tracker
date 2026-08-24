// Analysis port — persistence for the pull_request_analyses tracking table. This
// is analysis-owned state (distinct from the vcs PR mirror): the per-PR analyser
// run row whose id doubles as the analyser task_id, its comment id, and the
// stored structured review. The PullRequestAnalysisService depends on this role
// instead of hitting the table inline (the golden-standard fix).

import type { PrAnalysis, PrFinding, ReviewRoundCommit, ReviewRunProfile, ReviewRunScope } from "@/lib/shared/types"

/** The idempotency/comment view of a PR's tracking row. */
export interface PullRequestAnalysisTracking {
    id: string
    status: string | null
    githubCommentId: number | null
    /** The head the last run covered — a finished run at the same head is not
     *  worth repeating (migration 0042). */
    headSha: string | null
    /** A head a push moved to WHILE this run was in flight (0080). The callback
     *  starts the next round for it; until then it is the only record that the
     *  pull request has moved on. */
    pendingHeadSha: string | null
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
    /** The head this run reviewed, and any head that arrived while it ran (0080).
     *  The callback compares them to decide whether the PR has already moved on. */
    headSha: string | null
    pendingHeadSha: string | null
    /** What this run was SCOPED to, written at dispatch (0081) — including the
     *  findings it is carrying forward. The callback reads it to merge them into
     *  the one findings list; re-deriving the decision here would compare against
     *  a head that has since moved. Null on a run that predates incremental
     *  review, and on any run that could not record it. */
    reviewScope: ReviewRunScope | null
}

/** One completed review of one head (0080). */
export interface ReviewRound {
    headSha: string
    round: number
    status: string
    verdict: string | null
    score: number | null
    scoreMax: number | null
    findings: PrFinding[]
    /** The grounded pass did not complete, so this round may not resolve
     *  anything — see diffRounds. */
    degraded: boolean
    reviewProfile: ReviewRunProfile | null
    analyserBuild: string | null
    createdAt: string

    // ── scope + provenance (0081) ───────────────────────────────────────────
    /** What this round reviewed, and which rule chose it. Rounds written before
     *  0081 read as "full", which is what they were. */
    scope: "full" | "incremental"
    scopeReason: string | null
    /** The range this round covered: the head the LAST round reviewed (null on a
     *  first round) and the pull request's base. */
    prevHeadSha: string | null
    baseSha: string | null
    /** The commits between prevHeadSha (or the base) and headSha. */
    commits: ReviewRoundCommit[]
    /** How many findings rode along unexamined, and how many files the reviewer
     *  was given. */
    carriedCount: number
    reviewedFiles: number | null
    /** Blockers the previous round had that this one does not, stamped with the
     *  head that closed them. Never part of `findings` — see the migration. */
    resolved: PrFinding[]
}

/** What a completing run records as its round. */
export interface ReviewRoundInsert {
    projectId: string
    prNumber: number
    headSha: string
    status: string
    result: PrAnalysis | null
    reviewProfile: ReviewRunProfile | null

    // ── scope + provenance (0081) ───────────────────────────────────────────
    /** The decision this run was dispatched under, read back from the tracking
     *  row. Absent leaves the round reading as a full review, which is the only
     *  honest default: a round that cannot say it was scoped was not. */
    scope?: "full" | "incremental"
    scopeReason?: string | null
    prevHeadSha?: string | null
    baseSha?: string | null
    commits?: ReviewRoundCommit[]
    carriedCount?: number
    reviewedFiles?: number | null
    resolved?: PrFinding[]
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
    /** What this run is scoped to, and what it carries (0081). Written at
     *  dispatch for the same reason as the profile: the decision is made here,
     *  and the callback that has to honour it runs minutes later against a head
     *  that may have moved again. */
    reviewScope: ReviewRunScope | null
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

    /** Park a review as 'queued' — the team was at its concurrency cap (0085).
     *
     *  Separate from upsertTracking, and deliberately NOT it, because a queued
     *  review has not chosen a profile or a scope yet: those are resolved at
     *  dispatch so the row describes what actually ran, which is exactly why
     *  `reviewProfile` above is not optional. This writes only what the queue
     *  needs — the head to review when a slot frees, and the placeholder comment
     *  to reuse if one already exists — and leaves the attribution columns alone
     *  for the dispatch that follows to fill in. */
    enqueueTracking(input: {
        projectId: string
        prNumber: number
        headSha: string | null
        githubCommentId: number | null
    }): Promise<void>
    /** The tracking row by task id (its own id), for the terminal callback. */
    findResultRow(taskId: string): Promise<PullRequestAnalysisResultRow | null>
    /** Persist the terminal status + structured review (fires the pr_analysis_ready
     *  feed trigger). */
    saveResult(taskId: string, status: string, result: PrAnalysis | null): Promise<void>

    // ── rounds (0080) ───────────────────────────────────────────────────────

    /** Record a completed review as a round. The round NUMBER is assigned by the
     *  store from what is already there, so two callbacks racing cannot both
     *  claim the same ordinal. */
    appendRound(input: ReviewRoundInsert): Promise<void>
    /** Rounds for a PR, newest first, bounded. */
    listRounds(projectId: string, prNumber: number, limit: number): Promise<ReviewRound[]>
    /** Note that the PR moved while a review was in flight. */
    setPendingHead(projectId: string, prNumber: number, headSha: string): Promise<void>
    /** Clear it once the next round has been started for it. */
    clearPendingHead(projectId: string, prNumber: number): Promise<void>
}
