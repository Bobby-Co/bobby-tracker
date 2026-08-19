// Billing module — the prowl_usage_events READ port. The ledger is written by the
// ANALYSER (bobby-analyser records each billable call directly, service-role); this
// reads it back for the balance meter and the recent-activity list, RLS-scoped to
// the caller's team.

/** One recorded model call, as the UI reads it. */
export interface UsageEventRow {
    id: string
    kind: string
    model: string | null
    points: number
    cost_usd: number | null
    input_tokens: number | null
    output_tokens: number | null
    project_id: string | null
    created_at: string
}

/** Points spent per call-kind over a window — feeds the usage breakdown. */
export interface UsageByKind {
    kind: string
    points: number
    calls: number
}

/** A team's maintained period counter (the O(1) read path — trigger-kept). */
export interface PeriodUsage {
    points: number
    costUsd: number
    calls: number
}

export interface UsageRepository {
    /** The team's spend for the billing period anchored at `periodStart`, read
     *  from the maintained rollup (tracker.prowl_usage_period) — a single-row
     *  lookup, NOT a scan of the event log. Returns zeros when the period has no
     *  events yet. THROWS RepositoryError on failure. */
    currentPeriodUsage(teamId: string, periodStart: string): Promise<PeriodUsage>

    /** The same period read, but across EVERY team a usage subject has spent
     *  through (0076) — including deleted ones, whose rollup rows survive now
     *  that the cascade is gone. This is what makes a balance follow its owner
     *  across a team deletion instead of resetting. An empty list reads as zero
     *  without touching the database. THROWS. */
    subjectPeriodUsage(teamIds: string[], periodStart: string): Promise<PeriodUsage>

    /** Per-kind point + call totals since `sinceIso`, highest spend first. Scans
     *  the raw event log — used only on the detailed Usage page (low frequency),
     *  not on the hot balance path. */
    breakdownSince(teamId: string, sinceIso: string): Promise<UsageByKind[]>

    /** The team's most recent `limit` usage events, newest first. */
    listRecent(teamId: string, limit: number): Promise<UsageEventRow[]>
}
