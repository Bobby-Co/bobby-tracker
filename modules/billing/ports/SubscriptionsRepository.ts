// Billing module — the team_subscriptions persistence PORT. Owns the one
// subscription row per team (tier + optional negotiated allowance + period). RLS
// scopes reads to the caller's teams; the tier mutation is admin-gated at the DB
// and re-checked in the route.

import type { TierId } from "../domain/Tier"

/** A team's subscription row. `monthly_points` is a negotiated override — null
 *  means "use the tier's catalogue default" (see Balance). */
export interface SubscriptionRow {
    team_id: string
    tier: TierId
    monthly_points: number | null
    period_start: string
    status: "active" | "past_due" | "canceled" | "suspended"
    /** Stripe's identity for this team. Null until the team first checks out. */
    stripe_customer_id: string | null
    stripe_subscription_id: string | null
    /** The last Checkout Session started, so an abandoned one can be resumed
     *  rather than duplicated (0089). Safe to be stale. */
    stripe_checkout_session_id: string | null
    /** The window currently being billed (0088). Both the window a balance is
     *  measured over AND the key its usage is rolled up under — a free team,
     *  which has neither, falls back to the calendar month. */
    current_period_start: string | null
    current_period_end: string | null
    cancel_at_period_end: boolean
}

/** What a Stripe webhook tells us about a subscription. Every field is optional
 *  except the status, because different events carry different subsets and a
 *  patch must never blank a column an event simply did not mention. */
export interface SubscriptionPatch {
    tier?: TierId
    status: SubscriptionRow["status"]
    stripe_customer_id?: string | null
    stripe_subscription_id?: string | null
    current_period_start?: string | null
    current_period_end?: string | null
    cancel_at_period_end?: boolean
}

export interface SubscriptionsRepository {
    /** The team's subscription, or null when absent (a team created before its
     *  provisioning trigger ran, or an unknown team). THROWS RepositoryError on a
     *  genuine query failure. */
    findByTeam(teamId: string): Promise<SubscriptionRow | null>

    /** Pause or resume a team's subscription (0076). 'suspended' means the team
     *  is kept but may not spend, and its free slot is released — the mirror of
     *  usage_subjects.status, kept in step so the two billing surfaces never
     *  disagree. THROWS RepositoryError on failure. */
    setStatus(teamId: string, status: SubscriptionRow["status"]): Promise<void>

    /** Change a team's tier and return the updated row. Admin-gated by RLS; the
     *  route re-checks the role. THROWS RepositoryError on failure. */
    setTier(teamId: string, tier: TierId): Promise<SubscriptionRow>

    /** The team behind a Stripe subscription / customer.
     *
     *  How an INVOICE webhook finds its team. Invoice payloads carry Stripe ids,
     *  not ours, and resolving through our own table is deliberate: the
     *  alternative is trusting metadata copied onto the invoice, which is absent
     *  on anything created outside our checkout flow. THROWS. */
    findByStripeSubscription(subscriptionId: string): Promise<SubscriptionRow | null>
    findByStripeCustomer(customerId: string): Promise<SubscriptionRow | null>

    /** Remember the Checkout Session just started for this team. Best-effort by
     *  contract: failing to record it costs a resume, not a purchase, so the
     *  caller must not let it break checkout. THROWS. */
    setCheckoutSession(teamId: string, sessionId: string | null): Promise<void>

    /** Apply a subscription change from the payment provider. Service-role: the
     *  webhook has no session, and this is the one write that may change what a
     *  team is entitled to. THROWS. */
    applySubscription(teamId: string, patch: SubscriptionPatch): Promise<void>
}
