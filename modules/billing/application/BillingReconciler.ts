// BillingReconciler — make our record match what the payment provider says.
//
// ─── Why this has to exist ───────────────────────────────────────────────────
//
// Entitlement is granted by webhook, and a webhook is a message that can be lost.
// Every one of these has happened or can:
//
//   * the endpoint was briefly down, or mid-deploy, when Stripe delivered;
//   * the signing secret in the environment did not match the endpoint's, so
//     every delivery was correctly rejected as unverifiable;
//   * the buyer paid against one environment while the webhook pointed at
//     another — a checkout started on localhost is the classic case;
//   * a schema change had not been applied yet, so applying the event threw.
//
// In all of them the payment is REAL and only our record of it is missing. The
// customer has been charged and is getting nothing, which is the worst failure
// this system can have — so it cannot be left to a support ticket.
//
// ─── Stripe is the authority; this is how we ask ────────────────────────────
//
// Reconciling pulls the truth and applies it through SubscriptionSync — the SAME
// code a webhook goes through. That is the important part: recovery does not get
// its own opinion about what a subscription means, so a reconciled team lands in
// exactly the state a delivered webhook would have produced.
//
// ─── Safe to run whenever, which is what makes it useful ────────────────────
//
// Idempotent end to end (every write underneath is an upsert or a field
// assignment), so it can be called on the checkout return, from a button, or on
// any billing page load without needing to know whether it is needed. Given this
// stack has no scheduler, "runs when someone looks" is the only reconciliation
// loop available — and it happens to fire exactly when it matters most: the
// moment a paying customer comes back and looks at their plan.

import type { PaymentGateway } from "../ports/PaymentGateway"
import type { InvoicesRepository } from "../ports/InvoicesRepository"
import type { SubscriptionsRepository } from "../ports/SubscriptionsRepository"
import type { SubscriptionSync } from "./SubscriptionSync"

export interface ReconcileResult {
    /** True when the reconcile changed what the team is entitled to. */
    changed: boolean
    /** How the subscription was found, for the log — knowing WHICH hint rescued a
     *  team is what tells you which link is being lost. */
    via: "already-linked" | "checkout-session" | "provider-lookup" | "none"
    invoicesMirrored: number
    tier: string | null
    status: string | null
}

/** How many invoices to pull back. Enough to cover a long webhook outage without
 *  turning a page load into a paginated crawl through billing history. */
const INVOICE_BACKFILL = 12

export class BillingReconciler {
    constructor(
        private readonly subscriptions: SubscriptionsRepository,
        private readonly invoices: InvoicesRepository,
        private readonly gateway: PaymentGateway,
        private readonly sync: SubscriptionSync,
    ) {}

    /** `force` skips the "is there anything to look for" shortcut and asks the
     *  provider regardless.
     *
     *  It exists because the worst case has NO local hints at all: if the webhook
     *  never landed AND the checkout session was never recorded, we hold nothing
     *  linking the team to Stripe — which is precisely the team that paid and got
     *  nothing. Only the search by team metadata can rescue that one, and the
     *  shortcut below would skip straight past it.
     *
     *  So force is passed whenever a HUMAN is asserting that a payment happened —
     *  the return from checkout, and the "check with Stripe" button — and omitted
     *  for incidental page loads, where it would be a Stripe round trip for every
     *  free team in the system. */
    async reconcileTeam(teamId: string, opts: { force?: boolean } = {}): Promise<ReconcileResult> {
        const before = await this.subscriptions.findByTeam(teamId)

        const hasAnyHint =
            !!before?.stripe_subscription_id ||
            !!before?.stripe_checkout_session_id ||
            !!before?.stripe_customer_id
        if (!hasAnyHint && !opts.force) {
            return { changed: false, via: "none", invoicesMirrored: 0, tier: before?.tier ?? null, status: null }
        }

        const found = await this.gateway.findSubscriptionForTeam({
            teamId,
            subscriptionId: before?.stripe_subscription_id,
            checkoutSessionId: before?.stripe_checkout_session_id,
            customerId: before?.stripe_customer_id,
        })

        if (!found || found.kind !== "subscription") {
            return {
                changed: false,
                via: "none",
                invoicesMirrored: 0,
                tier: before?.tier ?? null,
                status: before?.status ?? null,
            }
        }

        const via: ReconcileResult["via"] = before?.stripe_subscription_id
            ? "already-linked"
            : before?.stripe_checkout_session_id
              ? "checkout-session"
              : "provider-lookup"

        // Through the SAME path a webhook takes. Recovery must not invent its own
        // rules for what a subscription entitles a team to.
        //
        // The team id is forced to the one being reconciled: a subscription found
        // by session or by customer may predate the metadata we now stamp, and
        // letting a null team id fall through would make the sync refuse the very
        // record we just went and found.
        await this.sync.apply({ ...found, teamId })

        const customerId = found.customerId || before?.stripe_customer_id
        let mirrored = 0
        if (customerId) {
            // Best-effort. A team's ENTITLEMENT is now correct; the invoice
            // history is a record of it, and failing to rebuild that must not
            // make the reconcile look like it failed.
            try {
                const invoices = await this.gateway.listInvoicesForCustomer(customerId, INVOICE_BACKFILL)
                for (const invoice of invoices) {
                    await this.invoices.upsert(teamId, invoice)
                    mirrored++
                }
            } catch (e) {
                console.warn(`[reconcile] invoice backfill failed for ${teamId}:`, (e as Error).message)
            }
        }

        const changed =
            before?.tier !== found.tier ||
            before?.status !== found.status ||
            before?.stripe_subscription_id !== found.subscriptionId

        return { changed, via, invoicesMirrored: mirrored, tier: found.tier, status: found.status }
    }
}
