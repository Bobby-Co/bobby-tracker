// Balance — the per-period Prowl Points picture for a team (pure domain). Folds a
// team's tier, its optional negotiated allowance override, and the points already
// spent this period into the numbers the UI and any future enforcement gate read:
// allowance, used, remaining, and a 0–1 fraction for the meter.

import { Tier, type TierId } from "./Tier"
import { entitledTier, isPaidUp, type EntitlementStatus } from "./Entitlement"

export interface BalanceInput {
    /** The tier the team BOUGHT. What it may currently use can be lower — see
     *  `status` and domain/Entitlement.ts. */
    tier: TierId | string | null
    /** Billing status. Anything but 'active' entitles the team to the free tier
     *  instead of the one it bought: an unpaid month's credits were never bought,
     *  so there is nothing to top up. Defaults to 'active' so a caller with no
     *  subscription in hand (a team predating billing) reads as it always did. */
    status?: EntitlementStatus | string | null
    /** Per-team monthly allowance override (negotiated Apex deals). `null` ⇒ use
     *  the tier default. Ignored for uncapped tiers. */
    allowanceOverride?: number | null
    /** Prowl Points spent since the current period started. */
    used: number
    /** ISO timestamp the current billing period started. */
    periodStart: string
}

export class Balance {
    /** What the team may USE. Equal to `plan` whenever the bill is paid. */
    readonly tier: Tier
    /** What the team BOUGHT. The UI shows this — a past-due Prowler team is still
     *  on Prowler, and telling them they are on Kit would be both wrong and
     *  alarming. */
    readonly plan: Tier
    /** True when the plan is a paid one that is not currently paid up. */
    readonly pastDue: boolean
    /** Monthly allowance in Prowl Points, or `null` when uncapped (Apex). */
    readonly allowance: number | null
    readonly used: number
    readonly periodStart: string

    constructor(input: BalanceInput) {
        this.plan = Tier.of(input.tier)
        this.tier = entitledTier(input.tier, input.status ?? "active")
        this.pastDue = !this.plan.isFree && !isPaidUp(input.status ?? "active")
        this.used = Math.max(0, Math.round(input.used || 0))
        this.periodStart = input.periodStart
        // The override is a negotiated Apex figure and belongs to the PLAN, so it
        // is honoured only while the plan is. A past-due team falls back to the
        // free allowance like any other.
        this.allowance = this.tier.isUncapped
            ? null
            : this.pastDue
              ? this.tier.monthlyPoints
              : input.allowanceOverride ?? this.tier.monthlyPoints
    }

    /** Points left this period. `null` when uncapped. Never negative. */
    get remaining(): number | null {
        if (this.allowance === null) return null
        return Math.max(0, this.allowance - this.used)
    }

    /** Fraction of the allowance consumed, clamped to 0–1. 0 when uncapped. */
    get fraction(): number {
        if (!this.allowance) return 0
        return Math.min(1, Math.max(0, this.used / this.allowance))
    }

    /** True once a capped team has spent its whole allowance. Uncapped ⇒ never.
     *  This is the signal SpendGate reads to refuse a call — see
     *  modules/billing/application/SpendGate.ts. */
    get isExhausted(): boolean {
        return this.allowance !== null && this.used >= this.allowance
    }

    /** The period anchor for a team with no subscription row to carry one: the
     *  first moment of the current UTC month. Lives here rather than being
     *  re-derived at each reader, because a balance and the gate that enforces it
     *  disagreeing about which period they are in is indistinguishable from a
     *  wrong allowance. */
    static currentPeriodStart(now: Date = new Date()): string {
        return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
    }

    /** First moment of the next period — the used counter resets here. */
    get periodEnd(): string {
        const start = new Date(this.periodStart)
        const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1))
        return end.toISOString()
    }

    toJSON() {
        return {
            tier: this.tier.id,
            tierName: this.tier.name,
            /** The purchased plan, which differs from `tier` only when past due. */
            plan: this.plan.id,
            planName: this.plan.name,
            pastDue: this.pastDue,
            allowance: this.allowance,
            used: this.used,
            remaining: this.remaining,
            fraction: this.fraction,
            isExhausted: this.isExhausted,
            uncapped: this.tier.isUncapped,
            periodStart: this.periodStart,
            periodEnd: this.periodEnd,
        }
    }
}
