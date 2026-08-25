// Pay-as-you-go — the rule, ahead of the feature (pure domain).
//
// DISABLED. Nothing calls this yet and no UI offers it; it exists so the rule is
// written down once, in the place the rest of billing already looks, rather than
// being invented under time pressure on the day it ships.
//
// ─── The rule ────────────────────────────────────────────────────────────────
//
// PAYG is an EXTENSION of a paid plan, never a replacement for one: a team may
// buy extra credits only while it is subscribed to at least the smallest paid
// tier, and paid up. Two reasons that constraint is worth enforcing rather than
// leaving to the UI:
//
//   * it is what stops PAYG becoming a way around the free tier. Without it, an
//     account could stay on Kit forever and simply top up, which is a worse deal
//     for them and an unpriced one for us;
//   * a card that has already succeeded on a subscription is a far better signal
//     than a card presenting itself for the first time to buy credits that are
//     spent within minutes and cannot be clawed back.
//
// ─── How it will attach when it is turned on ─────────────────────────────────
//
// As a second kind of credit grant, not a second balance. The monthly plan
// allowance is derived (tier × paid-up); a PAYG purchase would add an explicit
// grant row scoped to the same period, and Balance would sum the two. Both expire
// with the month, so "credits are for this month only" keeps meaning one thing.

import { Tier, type TierId } from "./Tier"
import { isPaidUp, type EntitlementStatus } from "./Entitlement"

/** Is this team, on this plan, allowed to buy extra credits?
 *
 *  Independent of whether the FEATURE is switched on — that is deployment state
 *  and lives with the composition root. This answers only "would this team
 *  qualify", which is a property of the plan and stays true whatever the flag
 *  says. */
export function payAsYouGoEligible(
    tier: TierId | string | null | undefined,
    status: EntitlementStatus | string | null | undefined,
): boolean {
    const plan = Tier.of(tier)
    // The free tier does not qualify, and neither does a plan nobody is currently
    // paying for — a past-due team topping up would be buying credits on a card
    // that has just failed.
    if (plan.isFree) return false
    return isPaidUp(status)
}
