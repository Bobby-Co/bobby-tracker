// When is an in-flight analysis actually abandoned?
//
// ensure() marks an issue 'analysing' before dispatching, and only the callback
// clears it. Every way that callback can be lost — an address the analyser can't
// route to, a redeploy mid-run, the analyser being killed — leaves the row
// claiming a run that will never finish, and the idempotency guard then refuses
// to start another one. Without a notion of staleness the issue is dead.
//
// This is the whole decision, kept pure so it can be tested without a database.

/** How long a run may claim to be in flight before we stop believing it.
 *
 *  Generous on purpose. A deep analysis on a large graph legitimately takes many
 *  minutes, and the cost of being too eager is real: a second run against the
 *  same issue costs money and can race the first one's callback. The cost of
 *  being too patient is only that a broken issue stays broken slightly longer,
 *  which someone can wait out. When unsure, wait. */
export const ANALYSIS_STALE_AFTER_MS = 30 * 60_000

/** Whether a run marked 'analysing' should be treated as abandoned.
 *
 *  A null or unparseable start time reads as STALE. That is what lets rows
 *  wedged before analysis_started_at existed (0071) recover by themselves —
 *  they have no start time and never will, and refusing to retry them forever is
 *  strictly worse than allowing one retry. */
export function analysisIsAbandoned(
    startedAt: string | null | undefined,
    now: number = Date.now(),
    staleAfterMs: number = ANALYSIS_STALE_AFTER_MS,
): boolean {
    if (!startedAt) return true
    const started = Date.parse(startedAt)
    if (Number.isNaN(started)) return true
    // A start time in the FUTURE means clock skew between the writer and us.
    // Treat it as live rather than abandoned: skew should not trigger duplicate
    // paid runs.
    if (started > now) return false
    return now - started >= staleAfterMs
}
