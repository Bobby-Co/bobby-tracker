// The payment provider, as this module needs it — PORT.
//
// Everything crossing this boundary is OUR vocabulary, never Stripe's. Webhook
// payloads are normalised into the small event set below before anything in the
// application layer sees them, for three reasons: the sync logic can then be
// tested without a Stripe fixture, Stripe's nine subscription statuses collapse
// to our four in exactly one place, and a future provider (or Stripe's next API
// version renaming a field) is a change to one adapter.

import type { TierId } from "../domain/Tier"
import type { EntitlementStatus } from "../domain/Entitlement"

/** What we ask for when a team buys a plan. */
export interface CheckoutRequest {
    teamId: string
    tier: TierId
    /** Reuse the team's existing Stripe customer when it has one, so a second
     *  purchase does not create a duplicate customer with its own card on file. */
    customerId: string | null
    customerEmail: string | null
    successUrl: string
    cancelUrl: string
}

/** An invoice as we mirror it. Deliberately without a team id: the adapter knows
 *  Stripe's ids, and resolving those to a team is a database question that
 *  belongs to the sync service, not to the transport. */
export interface InvoiceFacts {
    stripeInvoiceId: string
    number: string | null
    status: "draft" | "open" | "paid" | "uncollectible" | "void"
    /** Minor units (cents), as Stripe reports them. */
    amountDue: number
    amountPaid: number
    currency: string
    tier: TierId | null
    periodStart: string | null
    periodEnd: string | null
    hostedInvoiceUrl: string | null
    invoicePdf: string | null
    issuedAt: string | null
    paidAt: string | null
}

/** A verified, normalised webhook.
 *
 *  `ignored` is a case rather than a null so the route can answer 200 and say
 *  which type it skipped — Stripe retries anything that is not acknowledged, and
 *  an event we do not care about must not look like an event we failed. */
export type BillingEvent =
    | {
          kind: "subscription"
          /** From subscription metadata, which we set at checkout. Null means the
           *  subscription was created outside our flow (in the Stripe dashboard,
           *  say) and the sync has to resolve the team some other way. */
          teamId: string | null
          customerId: string
          subscriptionId: string
          /** Null when the price on the subscription maps to no tier we know —
           *  a price created in the dashboard, or an env var pointing at the
           *  wrong one. The sync treats that as "do not touch the tier". */
          tier: TierId | null
          status: EntitlementStatus
          /** The window being billed. Since 0088 this is also the key usage is
           *  rolled up under, so it is not display-only. */
          currentPeriodStart: string | null
          currentPeriodEnd: string | null
          cancelAtPeriodEnd: boolean
      }
    | { kind: "subscription_ended"; teamId: string | null; customerId: string; subscriptionId: string }
    | {
          kind: "invoice"
          /** Copied by Stripe from the subscription's metadata, which we stamp at
           *  checkout. Present means the invoice can be attributed WITHOUT our
           *  tables already knowing the subscription — which is what stops one
           *  failed subscription write orphaning every invoice behind it. */
          teamId: string | null
          customerId: string | null
          subscriptionId: string | null
          invoice: InvoiceFacts
      }
    | { kind: "ignored"; type: string }

/** Moving an existing subscription to another plan. */
export interface ChangePlanRequest {
    subscriptionId: string
    customerId: string
    tier: TierId
    /** Value of the customer's unused credits, in cents, to take off the invoice
     *  raised by this change. Computed by domain/UpgradeCredit.ts — Stripe knows
     *  nothing about credits, so it cannot work this out itself. */
    discountCents: number
}

/** Everything we might know about where a team's subscription lives. Each field
 *  may be missing — recovery exists precisely for the case where they are. */
export interface SubscriptionLookup {
    teamId: string
    subscriptionId?: string | null
    checkoutSessionId?: string | null
    customerId?: string | null
}

export interface PaymentGateway {
    /** A hosted Checkout session for one plan. Returns the URL to send the buyer
     *  to, and the session's id so an abandoned attempt can be resumed rather
     *  than duplicated. THROWS if the tier has no configured price. */
    createCheckoutSession(req: CheckoutRequest): Promise<{ url: string; sessionId: string }>

    /** The URL of a previously started session, if it can still be used: open
     *  (not completed or expired) and for the SAME plan. Null otherwise — a
     *  session for a tier the buyer has since changed their mind about must not
     *  be handed back, or they would pay for the wrong thing.
     *
     *  Never throws for an unknown or expired id. A stale id is the normal case,
     *  not an error, and a failure here must not block a fresh checkout. */
    findResumableCheckout(sessionId: string, tier: TierId): Promise<{ url: string } | null>

    /** Stripe's own billing portal — card updates, cancellation, invoice history
     *  from the source. Everything here that we would otherwise have to build. */
    createPortalSession(customerId: string, returnUrl: string): Promise<{ url: string }>

    /** Move a subscription to another plan, charging the new plan's FULL price
     *  today and restarting the billing period from now.
     *
     *  Deliberately not Stripe's proration: proration values the unused portion
     *  of a TIME window, and what this product owes back is the unused portion of
     *  a CREDIT allowance. A team that burned its whole month in three days is
     *  owed nothing, and time-based proration would refund them most of it.
     *
     *  THROWS if the tier has no configured price. */
    changePlan(req: ChangePlanRequest): Promise<void>

    /** What does the PROVIDER say this team has? The recovery path.
     *
     *  Webhooks can be missed — an endpoint that was briefly down, a secret that
     *  did not match, a deploy in the wrong window. When that happens the payment
     *  is real and only our record of it is missing, so the fix is to go and ask.
     *  Returns the same normalised event a webhook would have delivered, so both
     *  paths apply through identical code. Null when the team genuinely has none. */
    findSubscriptionForTeam(hints: SubscriptionLookup): Promise<BillingEvent | null>

    /** Recent invoices for a customer, for rebuilding the mirror after a gap. */
    listInvoicesForCustomer(customerId: string, limit: number): Promise<InvoiceFacts[]>

    /** Verify the signature and normalise. THROWS on a bad or stale signature —
     *  an unverified webhook is an unauthenticated request to change billing
     *  state, so it must never be handled. */
    readEvent(payload: string, signature: string): Promise<BillingEvent>

    /** Whether a tier can be bought at all (Apex is contact-sales, and any tier
     *  is unbuyable if its price id is not configured). */
    isPurchasable(tier: TierId): boolean
}
