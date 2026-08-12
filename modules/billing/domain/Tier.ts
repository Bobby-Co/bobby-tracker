// Prowl — the tier catalogue (pure domain). "Prowl" is Ucelot's usage-metering &
// credits system: the ocelot goes *on the prowl*, and every model call spends
// PROWL POINTS. Accounts sit on one of four wild-cat tiers, each with a monthly
// Prowl Point allowance.
//
// This file is the single source of truth for the plan ladder — display names,
// blurbs, monthly allowances and headline prices. It is pure (no DB / Next /
// Workers imports) so it can be shared by the API, the metering layer and the UI,
// and unit-tested in isolation. The persisted `team_subscriptions.tier` enum
// mirrors TierId; a per-team `monthly_points` override (for negotiated Apex deals)
// is layered on top at read time — see Balance.

/** The four tiers, low → high. Mirrors the tracker.prowl_tier Postgres enum. */
export type TierId = "kit" | "prowler" | "pride" | "apex"

export const TIER_IDS: readonly TierId[] = ["kit", "prowler", "pride", "apex"] as const

export interface TierSpec {
    id: TierId
    /** Display name shown in the UI. */
    name: string
    /** One-line positioning blurb. */
    tagline: string
    /** Monthly Prowl Point allowance. `null` = uncapped / negotiated (Apex). */
    monthlyPoints: number | null
    /** Headline monthly price in USD. `null` = "Custom" (contact sales). */
    priceUsd: number | null
    /** How many teammates the tier is meant for (soft, display-only for now). */
    seats: number | null
    /** Short feature bullets for the pricing cards. */
    features: string[]
}

// The ladder. Points/prices are deliberate placeholders for the foundation —
// they're config, not schema, so tuning them is a one-line change here with no
// migration. 1,000 Prowl Points ≈ $1 of underlying model spend (see ProwlPoints).
const CATALOGUE: Record<TierId, TierSpec> = {
    kit: {
        id: "kit",
        name: "Kit",
        tagline: "For solo explorers finding their footing.",
        monthlyPoints: 2_000,
        priceUsd: 0,
        seats: 1,
        features: [
            "2,000 Prowl Points / month",
            "Issue analysis & AI compose",
            "1 teammate",
            "Community support",
        ],
    },
    prowler: {
        id: "prowler",
        name: "Prowler",
        tagline: "For individuals shipping in earnest.",
        monthlyPoints: 40_000,
        priceUsd: 19,
        seats: 3,
        features: [
            "40,000 Prowl Points / month",
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
        priceUsd: 79,
        seats: 10,
        features: [
            "150,000 Prowl Points / month",
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
        priceUsd: null,
        seats: null,
        features: [
            "Uncapped Prowl Points",
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
    get isFree(): boolean {
        return this.spec.priceUsd === 0
    }
    /** True when this tier has no point ceiling (Apex). */
    get isUncapped(): boolean {
        return this.spec.monthlyPoints === null
    }
}
