// Prowl — the tier catalogue (pure domain). "Prowl" is Ucelot's usage-metering &
// credits system: the ocelot goes *on the prowl*, and every model call spends
// PROWL POINTS. Accounts sit on one of four wild-cat tiers, each with a monthly
// credit allowance.
//
// This file is the single source of truth for the plan ladder — display names,
// blurbs, monthly allowances and headline prices. It is pure (no DB / Next /
// Workers imports) so it can be shared by the API, the metering layer and the UI,
// and unit-tested in isolation. The persisted `team_subscriptions.tier` enum
// mirrors TierId; a per-team `monthly_points` override (for negotiated Apex deals)
// is layered on top at read time — see Balance.

/** The tiers, low → high. Mirrors the tracker.prowl_tier Postgres enum, which is
 *  why adding one is a migration (0087) and not only an edit here. */
export type TierId = "kit" | "scout" | "prowler" | "pride" | "apex"

export const TIER_IDS: readonly TierId[] = ["kit", "scout", "prowler", "pride", "apex"] as const

export interface TierSpec {
    id: TierId
    /** Display name shown in the UI. */
    name: string
    /** One-line positioning blurb. */
    tagline: string
    /** Monthly credit allowance. `null` = uncapped / negotiated (Apex). */
    monthlyPoints: number | null
    /** How many billable runs the tier may have IN FLIGHT at once. `null` =
     *  uncapped (Apex).
     *
     *  This is a safety bound, not a product feature, and it is the reason the
     *  monthly allowance cannot be blown past in one burst: the balance the gate
     *  reads only moves when the analyser flushes its meter (every $0.25 or two
     *  minutes), so without a ceiling on concurrency an arbitrary number of runs
     *  can pass the gate on the same stale reading. Capping in-flight work bounds
     *  that overshoot to `concurrentRuns × cost-per-run` regardless of how far
     *  the ledger lags.
     *
     *  Kept deliberately close to what the analyser can actually serve — its
     *  scheduler admits 2 queries at a time per cell — so the cap mostly stops
     *  work being QUEUED, which is also what keeps one team from monopolising a
     *  shared cell. */
    concurrentRuns: number | null
    /** Headline monthly price in USD. `null` = "Custom" (contact sales). */
    priceUsd: number | null
    /** How many teammates the tier is meant for (soft, display-only for now). */
    seats: number | null
    /** Short feature bullets for the pricing cards. */
    features: string[]
}

// The ladder. Points/prices are deliberate placeholders for the foundation —
// they're config, not schema, so tuning them is a one-line change here with no
// migration. 1,000 credits ≈ $1 of underlying model spend (see ProwlPoints).
const CATALOGUE: Record<TierId, TierSpec> = {
    kit: {
        id: "kit",
        name: "Kit",
        tagline: "For solo explorers finding their footing.",
        monthlyPoints: 2_000,
        concurrentRuns: 2,
        priceUsd: 0,
        seats: 1,
        features: [
            "2,000 credits / month",
            "Issue analysis & AI compose",
            "1 teammate",
            "Community support",
        ],
    },
    scout: {
        id: "scout",
        name: "Scout",
        tagline: "For solo builders past their first repo.",
        // 10,000 credits for $5 holds the ladder's ratio — Prowler is 2.1x
        // credits per dollar, Pride 1.9x, this 2.0x. Priced to be the smallest
        // real commitment rather than to change the economics: like every paid
        // tier here it breaks even around 50% utilisation, because credits are
        // sold at the cost of the underlying model spend (see ProwlPoints).
        monthlyPoints: 10_000,
        concurrentRuns: 3,
        priceUsd: 5,
        seats: 2,
        features: [
            "10,000 credits / month",
            "Everything in Kit",
            "PR review on your own repos",
            "Up to 2 teammates",
        ],
    },
    prowler: {
        id: "prowler",
        name: "Prowler",
        tagline: "For individuals shipping in earnest.",
        monthlyPoints: 40_000,
        concurrentRuns: 4,
        priceUsd: 19,
        seats: 3,
        features: [
            "40,000 credits / month",
            "Everything in Kit",
            "PR review & deep-dive chat",
            "Up to 3 teammates",
        ],
    },
    pride: {
        id: "pride",
        name: "Pride",
        tagline: "For teams hunting together.",
        monthlyPoints: 150_000,
        concurrentRuns: 8,
        priceUsd: 79,
        seats: 10,
        features: [
            "150,000 credits / month",
            "Everything in Prowler",
            "Shared team usage pool",
            "Up to 10 teammates",
            "Priority support",
        ],
    },
    apex: {
        id: "apex",
        name: "Apex",
        tagline: "For organisations at the top of the food chain.",
        monthlyPoints: null,
        concurrentRuns: null,
        priceUsd: null,
        seats: null,
        features: [
            "Unlimited credits",
            "Everything in Pride",
            "Unlimited teammates",
            "SSO, audit log & SLA",
            "Dedicated support",
        ],
    },
}

/** A tier as a small value object. `Tier.of(id)` never throws — an unknown id
 *  (e.g. a future enum value this build predates) folds to Kit, the safe floor. */
export class Tier {
    private constructor(readonly spec: TierSpec) {}

    static of(id: string | null | undefined): Tier {
        const spec = (id && CATALOGUE[id as TierId]) || CATALOGUE.kit
        return new Tier(spec)
    }

    /** The full ladder, low → high — for pricing tables. */
    static all(): Tier[] {
        return TIER_IDS.map((id) => new Tier(CATALOGUE[id]))
    }

    get id(): TierId {
        return this.spec.id
    }
    get name(): string {
        return this.spec.name
    }
    /** The tier's default monthly allowance (`null` = uncapped). A team may carry a
     *  per-team override — Balance applies it over this default. */
    get monthlyPoints(): number | null {
        return this.spec.monthlyPoints
    }
    /** How many billable runs may be in flight for this tier at once (`null` =
     *  uncapped). See TierSpec.concurrentRuns for why this exists. */
    get concurrentRuns(): number | null {
        return this.spec.concurrentRuns
    }
    get isFree(): boolean {
        return this.spec.priceUsd === 0
    }
    /** True when this tier has no point ceiling (Apex). */
    get isUncapped(): boolean {
        return this.spec.monthlyPoints === null
    }
}
