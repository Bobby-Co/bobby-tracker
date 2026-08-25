// What is this team actually entitled to right now? (pure domain)
//
// A team has a PLAN — the tier it bought — and an ENTITLEMENT — the tier it may
// currently use. They are the same thing whenever the bill is paid, and that is
// the only reason it is tempting to conflate them. They come apart the moment a
// card fails.
//
// ─── "A failed payment means no top-up" is this function ────────────────────
//
// Credits are bought a month at a time and expire with the month, so an unpaid
// period is not a debt to collect later — it is a month whose credits were never
// purchased. Rather than express that as a special case wherever an allowance is
// read ("...unless past due, in which case zero"), an unpaid team is simply
// entitled to the FREE tier. One rule, applied in one place, and every consumer
// of a tier — the monthly allowance, the concurrency cap, anything added later —
// degrades consistently without knowing that billing exists.
//
// Falling back to FREE rather than to NOTHING is deliberate. A card that expired
// over a weekend should cost a team its paid allowance, not its access to the
// product; anything harsher turns a routine payment hiccup into an outage and a
// support ticket. Stripe will retry and dun on its own schedule, and the team is
// on exactly the footing it would have had if it had never subscribed.

import { Tier, type TierId } from "./Tier"

/** Our subscription vocabulary — deliberately four cases, not Stripe's nine.
 *  The mapping down from Stripe lives in the payment adapter. */
export type EntitlementStatus = "active" | "past_due" | "canceled" | "suspended"

/** The tier every team falls back to: the free one. */
export const FREE_TIER_ID: TierId = "kit"

/** Is this team's plan currently paid for?
 *
 *  Only 'active' counts. 'canceled' keeps its tier until the period actually
 *  ends — Stripe reports that as active with cancel_at_period_end, and flips the
 *  status only when the period is over — so by the time we see 'canceled' the
 *  entitlement really has lapsed. */
export function isPaidUp(status: EntitlementStatus | string | null | undefined): boolean {
    return status === "active"
}

/** The tier a team may USE, as opposed to the one it bought.
 *
 *  A free plan is unaffected by billing status — there is nothing to have failed
 *  to pay — so it is returned as-is rather than being "downgraded" to itself. */
export function entitledTier(
    planTier: TierId | string | null | undefined,
    status: EntitlementStatus | string | null | undefined,
): Tier {
    const plan = Tier.of(planTier)
    if (plan.isFree || isPaidUp(status)) return plan
    return Tier.of(FREE_TIER_ID)
}
