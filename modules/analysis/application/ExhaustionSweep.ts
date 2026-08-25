// ExhaustionSweep — stop the work that is already running when the money runs out.
//
// ─── The hole this closes ────────────────────────────────────────────────────
//
// SpendGate refuses at DISPATCH. Nothing refuses at minute forty of a run that
// was dispatched while there were still credits. Because the analyser meters
// incrementally (a flush every $0.25 or two minutes) a team can cross its
// allowance mid-run, and before this the only consequence was that the NEXT
// dispatch would be refused — the crossing itself changed nothing about the work
// in progress, which carried on spending.
//
// So the balance moving is the event, and this is what happens on it: every run
// that team has in flight is cancelled. The pieces already existed — the analyser
// has cancel endpoints and a task registry, and the tracker already cancels a run
// when its issue or PR is closed. What was missing was anything WATCHING the
// balance. That watcher is a database trigger on the usage rollup (0084), because
// there is no scheduler in this stack to poll with.
//
// ─── Cancelling is not throwing money away ──────────────────────────────────
//
// A cancelled run still bills what it spent: RunMeter's Close() is deferred, so
// it runs on the cancel path and flushes the remainder. The team pays for the
// work done and stops paying for the work not yet done. Nothing is lost that was
// already bought.
//
// ─── Why it reuses SpendGate rather than reading the balance itself ─────────
//
// "Out of credits" must mean exactly one thing. If this computed its own answer
// it could sweep a team the gate would still admit, or leave one it refuses —
// both of which read as the product being broken rather than strict. Asking the
// gate also means a SUSPENDED team's runs get cancelled by the same pass, which
// is right and was not true before: pausing a team used to leave its in-flight
// work running to completion.

import type { SpendGate } from "@/modules/billing"
import type { ActiveRun, TeamRunRegistry } from "../ports/TeamRunRegistry"

/** How a sweep actually stops a run. Narrow on purpose — the sweep should not
 *  need the whole analysis service surface to do one thing to each row. */
export interface RunCanceller {
    cancelIssue(issueId: string): Promise<void>
    cancelPr(projectId: string, prNumber: number): Promise<void>
}

export interface SweepResult {
    /** Why the team was swept, or null when it was fine and nothing was done. */
    reason: string | null
    cancelled: number
    /** Runs whose cancel threw. They are counted, not retried: the analyser's
     *  cancel is best-effort by contract and the run will end on its own. */
    failed: number
}

export class ExhaustionSweep {
    constructor(
        private readonly spend: SpendGate,
        private readonly runs: TeamRunRegistry,
        private readonly canceller: RunCanceller,
    ) {}

    async sweep(teamId: string): Promise<SweepResult> {
        const refusal = await this.spend.check(teamId)
        // Still allowed to spend — the common case by far, since the trigger fires
        // on every rollup write and only a few of those cross a line. Costs one
        // balance read and stops.
        if (!refusal) return { reason: null, cancelled: 0, failed: 0 }

        const active = await this.runs.listForTeam(teamId)
        // Settled sequentially rather than with Promise.all: a swept team can have
        // a large burst in flight, and firing every cancel at one analyser at once
        // is a second stampede on a service already under one.
        let cancelled = 0
        let failed = 0
        for (const run of active) {
            try {
                await this.cancelOne(run)
                cancelled++
            } catch (e) {
                failed++
                console.warn(
                    `[spend-sweep] could not cancel ${run.kind} run ${run.taskId}: ${(e as Error).message}`,
                )
            }
        }
        return { reason: refusal.reason, cancelled, failed }
    }

    private cancelOne(run: ActiveRun): Promise<void> {
        if (run.kind === "issue") return this.canceller.cancelIssue(run.taskId)
        // A PR row with no number cannot be addressed; skip rather than guess.
        if (run.prNumber === undefined) return Promise.resolve()
        return this.canceller.cancelPr(run.projectId, run.prNumber)
    }
}
