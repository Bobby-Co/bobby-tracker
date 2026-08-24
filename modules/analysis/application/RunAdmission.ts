// RunAdmission — may this team START another run right now?
//
// ─── Why this exists next to SpendGate rather than inside it ─────────────────
//
// SpendGate answers "is there money left", from the ledger. That answer is always
// slightly out of date: the analyser meters incrementally and flushes every $0.25
// or two minutes, so between a run starting and its first flush the balance the
// gate reads has not moved at all. Fire fifty dispatches into that window and all
// fifty read the same number and all fifty pass. The gate is not wrong — it is
// being asked a question whose answer cannot keep up.
//
// Concurrency is the bound that does not depend on the ledger keeping up. Cap the
// runs in flight and the overshoot is capped at `cap × cost-per-run` no matter how
// stale the balance is. So this is the burst control and the gate is the budget
// control, and they are separate because they fail for different reasons and are
// fixed by different things (wait vs upgrade).
//
// ─── A refusal here DEFERS, it does not deny ────────────────────────────────
//
// Callers do not turn this into an error. They record the run as 'queued' and let
// the next finishing run start it (0085) — being busy is a wait, not a failure.
// The refusal shape is shared with SpendGate anyway so that a dispatch path has
// one thing to handle, but the two are acted on differently on purpose: no
// credits means stop, at capacity means later.
//
// ─── Why it lives in the analysis module ────────────────────────────────────
//
// The ALLOWANCE is billing's (it comes off the tier ladder). The COUNT is not:
// runs are issue and PR rows, in this module's tables, on the data plane. Asking
// billing to count them would mean billing knowing what a run is and where it
// lives, and would put a cycle between the two composition roots. So billing
// answers "how many may they have" and this compares it with what they have.
//
// ─── Fail closed ────────────────────────────────────────────────────────────
//
// Both reads THROW rather than defaulting. A dispatcher that cannot establish the
// cap or the current count must not dispatch: the failure mode this whole control
// exists to prevent is unbounded concurrent work, and "the count query failed" is
// not evidence that there is none.

import type { RunAllowance, SpendRefusal } from "@/modules/billing"
import type { TeamRunRegistry } from "../ports/TeamRunRegistry"

export class RunAdmission {
    constructor(
        private readonly allowance: RunAllowance,
        private readonly runs: TeamRunRegistry,
    ) {}

    /** Null when the team may start another run, a refusal when it is already at
     *  its limit. THROWS if either side cannot be read. */
    async check(teamId: string): Promise<SpendRefusal | null> {
        const cap = await this.allowance.forTeam(teamId)
        // Uncapped (Apex): no count needed — nothing it could return would refuse.
        if (cap === null) return null

        const active = await this.runs.countForTeam(teamId)
        if (active < cap) return null

        return {
            reason: "too_many_runs",
            message:
                `This team already has ${cap} ${cap === 1 ? "analysis" : "analyses"} running. ` +
                `Wait for one to finish, or upgrade the plan in Settings → Billing to run more at once.`,
        }
    }
}
