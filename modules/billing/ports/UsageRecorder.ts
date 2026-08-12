// Billing module — the usage WRITE port. The metering layer (MeteringAnalyser)
// calls record() after every billable model call. Kept separate from the read
// repository because the writer is the TRUSTED service role (bypasses RLS) while
// reads are RLS-scoped to the caller — different clients, different trust.

/** Who to bill for a metered call: the active team, and the user who triggered it. */
export interface BillingSubject {
    teamId: string
    userId: string
}

/** One usage event to append to the ledger. `points` is pre-computed by the
 *  domain (pointsForUsage); the raw signals ride along for audit. */
export interface UsageEventInput {
    teamId: string
    userId: string | null
    kind: string
    model?: string | null
    points: number
    costUsd?: number | null
    inputTokens?: number | null
    outputTokens?: number | null
    projectId?: string | null
    meta?: Record<string, unknown>
}

export interface UsageRecorder {
    /** Append a usage event. Best-effort by contract: implementations must NOT let
     *  a metering failure surface to (and fail) the user's model call — they
     *  swallow/log their own errors. */
    record(event: UsageEventInput): Promise<void>
}
