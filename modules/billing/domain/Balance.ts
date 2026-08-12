// Balance — the per-period Prowl Points picture for a team (pure domain). Folds a
// team's tier, its optional negotiated allowance override, and the points already
// spent this period into the numbers the UI and any future enforcement gate read:
// allowance, used, remaining, and a 0–1 fraction for the meter.

import { Tier, type TierId } from "./Tier"

export interface BalanceInput {
    tier: TierId | string | null
    /** Per-team monthly allowance override (negotiated Apex deals). `null` ⇒ use
     *  the tier default. Ignored for uncapped tiers. */
    allowanceOverride?: number | null
    /** Prowl Points spent since the current period started. */
    used: number
    /** ISO timestamp the current billing period started. */
    periodStart: string
}

export class Balance {
    readonly tier: Tier
    /** Monthly allowance in Prowl Points, or `null` when uncapped (Apex). */
    readonly allowance: number | null
    readonly used: number
    readonly periodStart: string

    constructor(input: BalanceInput) {
        this.tier = Tier.of(input.tier)
        this.used = Math.max(0, Math.round(input.used || 0))
        this.periodStart = input.periodStart
        this.allowance = this.tier.isUncapped
            ? null
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
     *  This is the signal a future enforcement gate would read to block a call. */
    get isExhausted(): boolean {
        return this.allowance !== null && this.used >= this.allowance
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
