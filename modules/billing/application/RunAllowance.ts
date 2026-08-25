// RunAllowance — how many billable runs may this team have in flight at once?
//
// The companion to SpendGate, and deliberately a SEPARATE question. The gate asks
// "is there money left", which is about the ledger. This asks "how much work may
// be running", which is about the fact that the ledger LAGS: the analyser flushes
// its meter every $0.25 or two minutes, so a burst of dispatches all read the
// same stale balance and all pass. Concurrency is the bound that survives that
// lag — cap the runs and you cap the overshoot, whatever the ledger says.
//
// It lives in billing because the number comes off the tier ladder, but it
// deliberately does NOT count runs: that would mean billing knowing what a run is
// and where its rows live. The caller counts its own in-flight work and compares.
// See modules/analysis/application/RunAdmission.ts, which does exactly that.

import { entitledTier } from "../domain/Entitlement"
import type { SubscriptionsRepository } from "../ports/SubscriptionsRepository"

export class RunAllowance {
    constructor(private readonly subscriptions: SubscriptionsRepository) {}

    /** How many concurrent billable runs this team is entitled to, or null when
     *  the tier is uncapped (Apex).
     *
     *  A team with no subscription row reads as Kit — the same floor the balance
     *  gate applies, and for the same reason: a missing row must not be a way to
     *  opt out of the limit. THROWS on a read failure, so the caller fails closed
     *  rather than dispatching unbounded work on a database blip. */
    async forTeam(teamId: string): Promise<number | null> {
        const subscription = await this.subscriptions.findByTeam(teamId)
        // The ENTITLED tier, not the purchased one: a past-due team falls back to
        // the free plan in every respect, concurrency included. One rule, in
        // domain/Entitlement.ts, so this and the allowance cannot drift apart.
        return entitledTier(subscription?.tier, subscription?.status).concurrentRuns
    }
}
