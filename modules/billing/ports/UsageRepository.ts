// Billing module — the prowl_usage_events READ port. The metering layer writes
// the ledger through UsageRecorder (service role); this reads it back for the
// balance meter and the recent-activity list, RLS-scoped to the caller's team.

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

export interface UsageRepository {
    /** Total Prowl Points spent by the team since `sinceIso`. THROWS
     *  RepositoryError on failure. */
    sumPointsSince(teamId: string, sinceIso: string): Promise<number>

    /** Per-kind point + call totals since `sinceIso`, highest spend first. */
    breakdownSince(teamId: string, sinceIso: string): Promise<UsageByKind[]>

    /** The team's most recent `limit` usage events, newest first. */
    listRecent(teamId: string, limit: number): Promise<UsageEventRow[]>
}
