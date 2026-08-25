// What an upgrade costs when the old plan still had credits in it (pure domain).
//
// ─── The rule ────────────────────────────────────────────────────────────────
//
//     discount = creditsLeft / currentPlan.credits × currentPlan.price
//
// A refund of the part of the CURRENT month the customer paid for and did not
// use. A Scout ($5 / 10,000) with 6,000 credits left has 60% of their month
// unspent, so $3.00 comes off the upgrade and they pay $16.00 for Prowler.
//
// ─── Why it is priced against the plan being LEFT, not the one being bought ──
//
// Because the discount is a refund, and you can only refund what was paid. An
// earlier version valued leftovers at the NEW plan's rate, which quietly refunded
// credits nobody had ever bought: a Kit team on the free tier would arrive at
// checkout holding 2,000 free credits and be handed $0.95 off for them. Pricing
// against the plan being left makes that fall out correctly — a free plan has a
// price of zero, so a free plan's leftovers are worth zero.
//
// It also gives the cap for free. The most that can come off is the whole of what
// they paid for this month, because the largest the fraction can be is 1.
//
// ─── The upgrade starts a fresh period ──────────────────────────────────────
//
// Which is what stops this being double-counting. The customer hands back the
// unused remainder of the old month as money, and receives a whole new month of
// the new plan — rather than keeping a part-spent allowance AND getting a refund
// for it. Renewal moves to the upgrade date, consistent with a purchase setting
// the renewal date everywhere else.

import { Tier, type TierId } from "./Tier"

/** Money, in the minor units Stripe deals in. Kept integral end to end: a
 *  discount computed in floats and rounded late is how an invoice ends up a cent
 *  away from what the UI promised. */
export interface UpgradeQuote {
    /** The new plan's full monthly price, in cents. */
    listCents: number
    /** Value of the unused credits, in cents. Never more than the list price. */
    discountCents: number
    /** What they actually pay today, in cents. Never below zero. */
    dueCents: number
    /** The credits that were valued — echoed back so the UI can explain the
     *  number rather than just assert it. */
    creditsApplied: number
}

/** Quote a move from `currentTier` to `targetTier` for a team holding
 *  `creditsLeft` credits.
 *
 *  `creditsLeft` is the balance's REMAINING points, already clamped at zero by
 *  Balance. A team that has overspent gets no discount rather than a surcharge. */
export function quoteUpgrade(
    targetTier: TierId | string | null,
    creditsLeft: number,
    currentTier: TierId | string | null,
): UpgradeQuote {
    const target = Tier.of(targetTier)
    const price = target.spec.priceUsd

    // An unpriced plan (Apex) is sold by hand; a quote here would be a number
    // nobody agreed to.
    if (price === null || price <= 0) {
        return { listCents: 0, discountCents: 0, dueCents: 0, creditsApplied: 0 }
    }
    const listCents = Math.round(price * 100)

    const current = Tier.of(currentTier)
    const paidFor = current.monthlyPoints
    const paidCents = current.spec.priceUsd === null ? 0 : Math.round(current.spec.priceUsd * 100)
    const credits = Math.max(0, Math.floor(creditsLeft || 0))

    // Nothing to refund: the plan being left was free (its credits cost nothing),
    // was uncapped (no allowance to take a fraction of), or is fully spent.
    if (paidCents <= 0 || paidFor === null || paidFor <= 0 || credits <= 0) {
        return { listCents, discountCents: 0, dueCents: listCents, creditsApplied: 0 }
    }

    // Never refund more of a month than there was. A negotiated allowance can put
    // the balance above the catalogue figure, and without this the fraction would
    // exceed 1 and refund more than was paid.
    const unused = Math.min(credits, paidFor)

    // Rounded DOWN, so a rounding error can never hand back more than the unused
    // month was worth. The customer loses at most one cent; the alternative is an
    // invoice that undercharges by a cent on every upgrade forever.
    const rawCents = Math.floor((unused / paidFor) * paidCents)

    // The refund cannot exceed what is being charged — an upgrade must not
    // produce a negative invoice. Surplus is not carried, it is simply not owed.
    const discountCents = Math.min(rawCents, listCents)

    return {
        listCents,
        discountCents,
        dueCents: listCents - discountCents,
        creditsApplied: unused,
    }
}
