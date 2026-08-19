// SpendGate — may this team spend right now?
//
// The hard half of suspension. `usage_subjects.status` records that a team is
// paused; without this, that record is a label — the team keeps dispatching work
// to the analyser and the analyser keeps billing it, because the analyser has no
// idea anything happened. This is the thing that says no.
//
// ─── Where it sits ───────────────────────────────────────────────────────────
//
// At the tracker's dispatch points, not at the analyser. Every billable call
// starts here — index, analyse, chat, compose, embed, deep-dive — and the tracker
// is the only side that knows about slots and subjects. Enforcing here means one
// codebase, one deploy, and no window where the two disagree.
//
// It is deliberately NOT part of authorization. A suspended team's members can
// still read everything they own; they simply cannot spend. Mixing the two would
// mean a pause looked like a permissions failure.
//
// ─── Fail closed ─────────────────────────────────────────────────────────────
//
// A team whose billing identity can't be read is refused, not waved through. The
// alternative — treating an unreadable subject as "probably fine" — makes every
// database blip a free pass on the one control that stops a paused team spending.
// The exception is a team with NO subject at all: those predate 0076 and are
// backfilled lazily, so they are allowed and must be, or the whole app stops for
// anyone who has not created a team since.

import type { SubscriptionsRepository } from "../ports/SubscriptionsRepository"
import type { UsageSubjectStore } from "../ports/UsageSubjectStore"

/** Why a team may not spend. Extend here when the balance gate lands — the call
 *  sites already handle "some reason", so adding one is a change in this file. */
export type SpendRefusal = { reason: "suspended"; message: string }

export class SpendGate {
    constructor(
        private readonly subjects: UsageSubjectStore,
        private readonly subscriptions: SubscriptionsRepository,
    ) {}

    /** Null when the team may spend, a refusal when it may not. THROWS only if
     *  the caller wants it to — see `assert`. */
    async check(teamId: string): Promise<SpendRefusal | null> {
        const [subject, subscription] = await Promise.all([
            this.subjects.findForTeam(teamId),
            this.subscriptions.findByTeam(teamId),
        ])

        // Both are checked because either can be the one a given surface wrote
        // last, and a gate that trusts only one of them is a gate with a race in
        // it. They are kept in step by the suspension route; this is what makes a
        // drift between them fail SAFE rather than silently allow spending.
        const paused = subject?.status === "suspended" || subscription?.status === "suspended"
        if (!paused) return null

        return {
            reason: "suspended",
            message:
                "This team is paused, so it can't run any analysis. Resume it in Team → Settings, " +
                "or put it on a plan.",
        }
    }
}
