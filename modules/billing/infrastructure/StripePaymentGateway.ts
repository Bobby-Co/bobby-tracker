// Stripe adapter for PaymentGateway — the ONLY file in the codebase that imports
// the Stripe SDK or knows a Stripe field name.
//
// ─── Running on Workers ──────────────────────────────────────────────────────
//
// Two things differ from the Node defaults and both are load-bearing:
//
//   * the HTTP client must be fetch-based (`createFetchHttpClient`), because
//     there are no Node sockets here;
//   * signature verification must be `constructEventAsync` with the SubtleCrypto
//     provider. The synchronous `constructEvent` needs Node's crypto and throws
//     at runtime on Workers — which would fail CLOSED (no webhook ever verified),
//     but silently, as a 500 Stripe retries forever.
//
// Both clients are built lazily and cached per isolate: constructing them costs a
// little, webhook and checkout traffic is bursty, and a module-level constructor
// would run at import time on every cold start whether or not billing is used.
//
// ─── The API-version drift this guards against ──────────────────────────────
//
// Stripe has moved two fields we depend on between versions: a subscription's
// period end migrated onto the subscription ITEM, and an invoice's subscription
// reference moved under `parent.subscription_details`. Both are read defensively
// below, because the failure they cause is not a type error at build time — it is
// a null at runtime, on the webhook that decides whether someone keeps their
// credits.

import Stripe from "stripe"
import type { TierId } from "../domain/Tier"
import { TIER_IDS, Tier } from "../domain/Tier"
import type { EntitlementStatus } from "../domain/Entitlement"
import type {
    SubscriptionLookup,
    BillingEvent,
    ChangePlanRequest,
    CheckoutRequest,
    InvoiceFacts,
    PaymentGateway,
} from "../ports/PaymentGateway"

let client: Stripe | null = null
let cryptoProvider: ReturnType<typeof Stripe.createSubtleCryptoProvider> | null = null

function stripe(): Stripe {
    if (!client) {
        const key = process.env.STRIPE_SECRET_KEY
        if (!key) throw new Error("STRIPE_SECRET_KEY is not configured")
        // No apiVersion pin: the SDK's default is the version its types describe,
        // and pinning to anything else makes the types a lie.
        client = new Stripe(key, { httpClient: Stripe.createFetchHttpClient() })
    }
    return client
}

/** The Stripe price backing a tier, from the environment.
 *
 *  Env rather than the tier catalogue because a price id is deployment state —
 *  test and live mode have different ones — while the catalogue is product copy
 *  that lives in git. */
function priceIdFor(tier: TierId): string | null {
    const id = process.env[`STRIPE_PRICE_${tier.toUpperCase()}`]
    return id && id.trim() ? id.trim() : null
}

function tierForPrice(priceId: string | null | undefined): TierId | null {
    if (!priceId) return null
    return TIER_IDS.find((t) => priceIdFor(t) === priceId) ?? null
}

/** Stripe's nine subscription statuses, mapped down to our four.
 *
 *  `incomplete` means the first payment has not succeeded yet, so it is past_due
 *  rather than active — the team must not be entitled to a plan nobody has paid
 *  for. `trialing` is active: a trial is a period someone is entitled to. */
function mapStatus(status: Stripe.Subscription.Status): EntitlementStatus {
    switch (status) {
        case "active":
        case "trialing":
            return "active"
        case "past_due":
        case "unpaid":
        case "incomplete":
            return "past_due"
        default:
            // canceled, incomplete_expired, paused
            return "canceled"
    }
}

function isoOrNull(seconds: number | null | undefined): string | null {
    return seconds ? new Date(seconds * 1000).toISOString() : null
}

/** A subscription's period start, wherever this API version keeps it.
 *
 *  Read for the same reason as the end: since 0088 this is BOTH the window a
 *  balance is measured over and the key the usage rollup is written under, so a
 *  null here means a team is metered against the calendar month while being
 *  billed for something else. */
function periodStartOf(sub: Stripe.Subscription): string | null {
    const item = sub.items?.data?.[0] as { current_period_start?: number } | undefined
    const legacy = (sub as unknown as { current_period_start?: number }).current_period_start
    return isoOrNull(item?.current_period_start ?? legacy)
}

/** A subscription's period end, wherever this API version keeps it. */
function periodEndOf(sub: Stripe.Subscription): string | null {
    const item = sub.items?.data?.[0] as { current_period_end?: number } | undefined
    const legacy = (sub as unknown as { current_period_end?: number }).current_period_end
    return isoOrNull(item?.current_period_end ?? legacy)
}

/** The team id Stripe copied onto the invoice from its subscription.
 *
 *  We stamp `team_id` on every subscription at checkout, and Stripe carries that
 *  metadata onto each invoice the subscription raises. Reading it makes an invoice
 *  SELF-DESCRIBING: it can be attributed without our database already knowing
 *  about the subscription.
 *
 *  That matters more than it sounds. Resolving invoices only through our own
 *  tables means a subscription event that fails to write takes every invoice for
 *  that subscription down with it — the invoices defer waiting for a link that is
 *  never made, retry until Stripe gives up, and are lost. This breaks that chain. */
function invoiceTeamId(invoice: Stripe.Invoice): string | null {
    const parent = (invoice as unknown as {
        parent?: { subscription_details?: { metadata?: Record<string, string> } }
    }).parent
    const legacy = (invoice as unknown as {
        subscription_details?: { metadata?: Record<string, string> }
    }).subscription_details
    return (
        parent?.subscription_details?.metadata?.team_id ??
        legacy?.metadata?.team_id ??
        invoice.metadata?.team_id ??
        null
    )
}

/** An invoice's subscription id, wherever this API version keeps it. */
function subscriptionIdOf(invoice: Stripe.Invoice): string | null {
    const parent = (invoice as unknown as {
        parent?: { subscription_details?: { subscription?: string | { id: string } } }
    }).parent
    const nested = parent?.subscription_details?.subscription
    const legacy = (invoice as unknown as { subscription?: string | { id: string } }).subscription
    const value = nested ?? legacy
    return typeof value === "string" ? value : (value?.id ?? null)
}

function idOf(value: string | { id: string } | null | undefined): string | null {
    if (!value) return null
    return typeof value === "string" ? value : value.id
}

/** A Stripe subscription as OUR subscription event.
 *
 *  Shared by the webhook and the reconciler on purpose. The two paths answer the
 *  same question — what is this team entitled to — and if they normalised
 *  separately, a recovery could quietly disagree with what a webhook would have
 *  written, which is a worse failure than the one recovery exists to fix. */
function toSubscriptionEvent(sub: Stripe.Subscription): BillingEvent {
    return {
        kind: "subscription",
        teamId: sub.metadata?.team_id ?? null,
        customerId: idOf(sub.customer) ?? "",
        subscriptionId: sub.id,
        tier: tierForPrice(idOf(sub.items?.data?.[0]?.price as { id: string } | undefined)),
        status: mapStatus(sub.status),
        currentPeriodStart: periodStartOf(sub),
        currentPeriodEnd: periodEndOf(sub),
        cancelAtPeriodEnd: sub.cancel_at_period_end ?? false,
    }
}

function toInvoiceFacts(invoice: Stripe.Invoice): InvoiceFacts {
    const line = invoice.lines?.data?.[0]
    const period = line?.period
    return {
        stripeInvoiceId: invoice.id as string,
        number: invoice.number ?? null,
        // Stripe's invoice statuses are already our set; the check constraint on
        // billing_invoices mirrors them exactly.
        status: (invoice.status ?? "draft") as InvoiceFacts["status"],
        amountDue: invoice.amount_due ?? 0,
        amountPaid: invoice.amount_paid ?? 0,
        currency: invoice.currency ?? "usd",
        tier: tierForPrice(idOf((line as unknown as { price?: { id: string } })?.price)),
        periodStart: isoOrNull(period?.start),
        periodEnd: isoOrNull(period?.end),
        hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
        invoicePdf: invoice.invoice_pdf ?? null,
        issuedAt: isoOrNull(invoice.created),
        paidAt: isoOrNull(invoice.status_transitions?.paid_at),
    }
}

export class StripePaymentGateway implements PaymentGateway {
    isPurchasable(tier: TierId): boolean {
        // Apex is priced "Custom" — there is nothing to check out. Anything else
        // is buyable only once its price id is actually configured, so a missing
        // env var shows up as a disabled button rather than a Stripe error.
        return Tier.of(tier).spec.priceUsd !== null && priceIdFor(tier) !== null
    }

    async findResumableCheckout(sessionId: string, tier: TierId): Promise<{ url: string } | null> {
        try {
            const session = await stripe().checkout.sessions.retrieve(sessionId)
            // `open` is Stripe's word for "not yet paid and not yet expired".
            // A completed one must never be reopened: the subscription it made
            // already exists, and sending someone back would buy a second.
            if (session.status !== "open" || !session.url) return null
            // The tier rides on the session's own metadata rather than being
            // inferred from line items, which are not expanded on a retrieve.
            if (session.metadata?.tier !== tier) return null
            return { url: session.url }
        } catch {
            // Unknown id, wrong mode, expired — all mean "no session to resume",
            // which is the ordinary case rather than a failure worth reporting.
            return null
        }
    }

    async createCheckoutSession(req: CheckoutRequest): Promise<{ url: string; sessionId: string }> {
        const price = priceIdFor(req.tier)
        if (!price) throw new Error(`no Stripe price configured for tier "${req.tier}"`)

        const session = await stripe().checkout.sessions.create(
            {
                mode: "subscription",
                line_items: [{ price, quantity: 1 }],
                // Reuse the customer when we have one; otherwise let Stripe create
                // it and prefill the email. Passing both is an error.
                ...(req.customerId
                    ? { customer: req.customerId }
                    : req.customerEmail
                      ? { customer_email: req.customerEmail }
                      : {}),
                // client_reference_id and metadata both carry the team, on the
                // session AND on the subscription it creates. The subscription's
                // copy is the one that matters: every later webhook is about the
                // subscription, long after the session is gone.
                client_reference_id: req.teamId,
                // `tier` is here so a resume can check the session still matches
                // what the buyer is asking for.
                metadata: { team_id: req.teamId, tier: req.tier },
                // No billing_cycle_anchor and no proration: the full monthly
                // price is charged today and the subscription renews on this
                // date each month. Value carried over from a previous plan is
                // handled as an explicit discount rather than by proration —
                // see domain/UpgradeCredit.ts — because the rule there values
                // leftover CREDITS, which Stripe knows nothing about.
                subscription_data: {
                    metadata: { team_id: req.teamId },
                },
                success_url: req.successUrl,
                cancel_url: req.cancelUrl,
                allow_promotion_codes: true,
            },
            // NO idempotency key. Stripe only replays a key with IDENTICAL
            // parameters, and a session's parameters legitimately change between
            // attempts — the customer id appears once one exists, the return URLs
            // move when routes do. A day-scoped key turned "the buyer came back to
            // finish paying" into a hard error, which is the worst possible moment
            // to fail. Duplicate sessions are prevented by RESUMING the open one
            // (see findResumableCheckout), which guards the same thing by handing
            // back the same session rather than replaying an old response.
        )
        if (!session.url) throw new Error("Stripe returned a checkout session with no URL")
        return { url: session.url, sessionId: session.id }
    }

    async changePlan(req: ChangePlanRequest): Promise<void> {
        const price = priceIdFor(req.tier)
        if (!price) throw new Error(`no Stripe price configured for tier "${req.tier}"`)

        const sub = await stripe().subscriptions.retrieve(req.subscriptionId)
        const item = sub.items?.data?.[0]
        if (!item) throw new Error(`subscription ${req.subscriptionId} has no line item to move`)

        // The credit goes on FIRST, so it exists before the invoice this update
        // raises. The failure ordering is deliberate: if the credit lands and the
        // plan change then fails, the customer holds an unused credit that
        // applies to their next invoice — recoverable, and in their favour. The
        // reverse order would charge full price and leave the discount owed.
        if (req.discountCents > 0) {
            await stripe().customers.createBalanceTransaction(
                req.customerId,
                {
                    // Negative is a CREDIT in Stripe's ledger. A sign error here
                    // bills the customer twice over, so it is worth staring at.
                    amount: -Math.round(req.discountCents),
                    currency: "usd",
                    description: `Unused credits applied to ${Tier.of(req.tier).name}`,
                },
                // Keyed on the AMOUNT, not the day. The discount moves as credits are
                // spent, so a day-scoped key would reject a genuinely different
                // request — while two clicks seconds apart, which is what this
                // actually guards, carry the same amount and dedupe correctly.
                { idempotencyKey: `upgrade-credit:${req.subscriptionId}:${req.tier}:${req.discountCents}` },
            )
        }

        await stripe().subscriptions.update(
            req.subscriptionId,
            {
                items: [{ id: item.id, price }],
                // Full price now, and the period restarts today — the same rule a
                // first purchase follows. `none` disables Stripe's own proration
                // because the discount above has already accounted for what was
                // left over, by credits rather than by time.
                proration_behavior: "none",
                billing_cycle_anchor: "now",
                metadata: { ...(sub.metadata ?? {}) },
            },
            { idempotencyKey: `upgrade:${req.subscriptionId}:${req.tier}:${req.discountCents}` },
        )
    }

    async createPortalSession(customerId: string, returnUrl: string): Promise<{ url: string }> {
        const session = await stripe().billingPortal.sessions.create({
            customer: customerId,
            return_url: returnUrl,
        })
        return { url: session.url }
    }

    async findSubscriptionForTeam(hints: SubscriptionLookup): Promise<BillingEvent | null> {
        // Ordered by how DIRECT each hint is, and by whether it can be trusted to
        // be up to date the instant a checkout completes.
        //
        // 1. A subscription we already linked. Nothing to discover.
        if (hints.subscriptionId) {
            const sub = await this.retrieveSubscription(hints.subscriptionId)
            if (sub) return toSubscriptionEvent(sub)
        }

        // 2. The Checkout Session we recorded when the buyer left for Stripe.
        //    This is the one that rescues the case recovery exists for — the
        //    webhook never arrived, so we know nothing EXCEPT that we sent them
        //    to this session. A completed session names the subscription it made,
        //    with no indexing delay.
        if (hints.checkoutSessionId) {
            try {
                const session = await stripe().checkout.sessions.retrieve(hints.checkoutSessionId)
                const subId = idOf(session.subscription as string | { id: string } | null)
                if (subId) {
                    const sub = await this.retrieveSubscription(subId)
                    if (sub) return toSubscriptionEvent(sub)
                }
            } catch {
                // Unknown or expired session — fall through to the wider searches.
            }
        }

        // 3. Anything this customer has. Covers a subscription created outside our
        //    checkout, or one whose session id we never managed to store.
        if (hints.customerId) {
            const list = await stripe().subscriptions.list({ customer: hints.customerId, limit: 10 })
            const best = pickMostRelevant(list.data)
            if (best) return toSubscriptionEvent(best)
        }

        // 4. Last resort: ask Stripe what carries our team id. We stamp it on
        //    every subscription at checkout, so this finds one even when every
        //    local link was lost. Deliberately LAST — search is indexed
        //    asynchronously and lags new objects by up to a minute, so it is the
        //    fallback rather than the first move.
        try {
            const found = await stripe().subscriptions.search({
                query: `metadata['team_id']:'${hints.teamId}'`,
                limit: 10,
            })
            const best = pickMostRelevant(found.data)
            if (best) return toSubscriptionEvent(best)
        } catch {
            // Search is unavailable on some accounts; not being able to run it is
            // not a reason to fail a reconcile that found nothing anyway.
        }

        return null
    }

    async listInvoicesForCustomer(customerId: string, limit: number): Promise<InvoiceFacts[]> {
        const list = await stripe().invoices.list({ customer: customerId, limit })
        return list.data.map(toInvoiceFacts)
    }

    private async retrieveSubscription(id: string): Promise<Stripe.Subscription | null> {
        try {
            return await stripe().subscriptions.retrieve(id)
        } catch {
            return null
        }
    }

    async readEvent(payload: string, signature: string): Promise<BillingEvent> {
        const secret = process.env.STRIPE_WEBHOOK_SECRET
        if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET is not configured")
        if (!cryptoProvider) cryptoProvider = Stripe.createSubtleCryptoProvider()

        // Async + SubtleCrypto: the synchronous form needs Node crypto and throws
        // on Workers. Throws on a bad signature, which is the point — this is the
        // only thing standing between the open internet and our billing state.
        const event = await stripe().webhooks.constructEventAsync(
            payload,
            signature,
            secret,
            undefined,
            cryptoProvider,
        )

        switch (event.type) {
            case "customer.subscription.created":
            case "customer.subscription.updated":
            case "customer.subscription.resumed":
                return toSubscriptionEvent(event.data.object as Stripe.Subscription)
            case "customer.subscription.deleted": {
                const sub = event.data.object as Stripe.Subscription
                return {
                    kind: "subscription_ended",
                    teamId: sub.metadata?.team_id ?? null,
                    customerId: idOf(sub.customer) ?? "",
                    subscriptionId: sub.id,
                }
            }
            case "invoice.created":
            case "invoice.finalized":
            case "invoice.paid":
            case "invoice.payment_failed":
            case "invoice.payment_succeeded":
            case "invoice.marked_uncollectible":
            case "invoice.voided": {
                const invoice = event.data.object as Stripe.Invoice
                return {
                    kind: "invoice",
                    teamId: invoiceTeamId(invoice),
                    customerId: idOf(invoice.customer),
                    subscriptionId: subscriptionIdOf(invoice),
                    invoice: toInvoiceFacts(invoice),
                }
            }
            default:
                return { kind: "ignored", type: event.type }
        }
    }
}

/** Composition seam. Constructed per request; the SDK client itself is cached. */
export function createStripePaymentGateway(): PaymentGateway {
    return new StripePaymentGateway()
}

/** The subscription that best describes what a team is entitled to.
 *
 *  A customer can hold several — an old canceled one beside a live one, or two
 *  from a duplicated checkout. A LIVE subscription always wins over a dead one,
 *  and among equals the newest does; picking the first Stripe happened to return
 *  would let a canceled subscription overwrite a paid one. */
function pickMostRelevant(subs: Stripe.Subscription[]): Stripe.Subscription | null {
    if (subs.length === 0) return null
    const rank = (s: Stripe.Subscription) =>
        s.status === "active" || s.status === "trialing" ? 2 : s.status === "past_due" || s.status === "unpaid" ? 1 : 0
    return [...subs].sort((a, b) => rank(b) - rank(a) || (b.created ?? 0) - (a.created ?? 0))[0]
}
