// SubscriptionSync — apply a verified payment event to our own billing state.
//
// This is the whole of "we manage the subscription ourselves". Stripe runs the
// clock and moves the money; the moment it tells us something changed, THIS
// decides what the team is now entitled to. Nothing else in the app asks Stripe
// anything at request time — the gate reads our tables, which is what keeps a
// billable request from depending on a third party being reachable.
//
// ─── Events arrive out of order, and more than once ─────────────────────────
//
// Stripe guarantees neither ordering nor exactly-once delivery, so both are
// handled here rather than hoped for:
//
//   * DUPLICATES are free, because every write is an upsert or an idempotent
//     field assignment. Applying the same event twice lands on the same state.
//
//   * ORDER matters in exactly one place: an invoice can arrive before the
//     subscription that explains it, on a team's very first purchase. An invoice
//     we cannot attribute is reported as RETRYABLE rather than swallowed — Stripe
//     will redeliver, by which time the subscription event has almost always
//     landed. Swallowing it would silently lose the first invoice of every new
//     customer whose events raced.

import type { BillingEvent } from "../ports/PaymentGateway"
import type { InvoicesRepository } from "../ports/InvoicesRepository"
import type { SubscriptionsRepository } from "../ports/SubscriptionsRepository"
import { FREE_TIER_ID } from "../domain/Entitlement"

export type SyncOutcome =
    | { applied: true; teamId: string; what: string }
    /** Not applied, and not worth redelivering — an event type we do not act on. */
    | { applied: false; retryable: false; reason: string }
    /** Not applied YET. The route must answer non-2xx so Stripe redelivers. */
    | { applied: false; retryable: true; reason: string }

export class SubscriptionSync {
    constructor(
        private readonly subscriptions: SubscriptionsRepository,
        private readonly invoices: InvoicesRepository,
    ) {}

    async apply(event: BillingEvent): Promise<SyncOutcome> {
        switch (event.kind) {
            case "subscription": {
                const teamId = await this.resolveTeam(event.teamId, event.subscriptionId, event.customerId)
                if (!teamId) {
                    return { applied: false, retryable: false, reason: "no team for subscription" }
                }
                await this.subscriptions.applySubscription(teamId, {
                    // Only when the price maps to a tier we know. An unrecognised
                    // price means a subscription created outside this app, and
                    // guessing a tier from it would hand out an entitlement nobody
                    // chose; leaving the tier alone is the safe reading.
                    ...(event.tier ? { tier: event.tier } : {}),
                    status: event.status,
                    stripe_customer_id: event.customerId || null,
                    stripe_subscription_id: event.subscriptionId,
                    current_period_start: event.currentPeriodStart,
                    current_period_end: event.currentPeriodEnd,
                    cancel_at_period_end: event.cancelAtPeriodEnd,
                })
                return { applied: true, teamId, what: `subscription ${event.status}` }
            }

            case "subscription_ended": {
                const teamId = await this.resolveTeam(event.teamId, event.subscriptionId, event.customerId)
                if (!teamId) {
                    return { applied: false, retryable: false, reason: "no team for ended subscription" }
                }
                await this.subscriptions.applySubscription(teamId, {
                    // Back to the free tier explicitly, rather than relying on the
                    // entitlement rule to mask a paid tier the team no longer has.
                    // The UI should say "Kit", not "Prowler (canceled)" forever.
                    tier: FREE_TIER_ID,
                    status: "canceled",
                    // The link is cleared so a later purchase can create a fresh
                    // subscription — the unique index would otherwise reject it.
                    // The CUSTOMER is kept: it holds the card and the history.
                    stripe_subscription_id: null,
                    current_period_start: null,
                    current_period_end: null,
                    cancel_at_period_end: false,
                })
                return { applied: true, teamId, what: "subscription ended" }
            }

            case "invoice": {
                // Metadata FIRST. An invoice that names its own team can be
                // mirrored even when the subscription it belongs to has not been
                // written — which is exactly the state after a subscription event
                // failed, and the difference between losing one event and losing
                // every invoice behind it.
                const teamId = await this.resolveTeam(event.teamId, event.subscriptionId, event.customerId)
                if (!teamId) {
                    // See the header: almost always a first-purchase race, so ask
                    // for redelivery instead of dropping the invoice.
                    return {
                        applied: false,
                        retryable: true,
                        reason: `no team yet for invoice ${event.invoice.stripeInvoiceId}`,
                    }
                }
                await this.invoices.upsert(teamId, event.invoice)
                return { applied: true, teamId, what: `invoice ${event.invoice.status}` }
            }

            case "ignored":
                return { applied: false, retryable: false, reason: `unhandled type ${event.type}` }
        }
    }

    /** Our team id, from the most trustworthy source available.
     *
     *  Metadata first — we set it at checkout, so it is the only source that
     *  reflects what the buyer actually chose. Then the subscription id, then the
     *  customer: both are links WE recorded from an earlier event, so they cannot
     *  be spoofed by a payload, but they are only present once a first event has
     *  landed. */
    private async resolveTeam(
        fromMetadata: string | null,
        subscriptionId: string | null,
        customerId: string | null,
    ): Promise<string | null> {
        if (fromMetadata) return fromMetadata
        if (subscriptionId) {
            const bySub = await this.subscriptions.findByStripeSubscription(subscriptionId)
            if (bySub) return bySub.team_id
        }
        if (customerId) {
            const byCustomer = await this.subscriptions.findByStripeCustomer(customerId)
            if (byCustomer) return byCustomer.team_id
        }
        return null
    }
}
