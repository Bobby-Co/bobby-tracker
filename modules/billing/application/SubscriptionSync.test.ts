// Applying payment events to our own billing state.
//
// The cases that matter are the ones Stripe's delivery guarantees do NOT cover:
// duplicates, events that arrive out of order, and events about subscriptions we
// have never seen. The happy path is one test; the rest is why this class exists.

import { test, expect, describe, mock, beforeEach } from "bun:test"
import { SubscriptionSync } from "./SubscriptionSync"
import type { BillingEvent } from "../ports/PaymentGateway"

const subscriptions = {
    applySubscription: mock(),
    findByStripeSubscription: mock(),
    findByStripeCustomer: mock(),
}
const invoices = { upsert: mock() }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sync = () => new SubscriptionSync(subscriptions as any, invoices as any)

const subEvent = (over: Partial<Extract<BillingEvent, { kind: "subscription" }>> = {}) =>
    ({
        kind: "subscription",
        teamId: "t1",
        customerId: "cus_1",
        subscriptionId: "sub_1",
        tier: "prowler",
        status: "active",
        currentPeriodEnd: "2026-09-01T00:00:00.000Z",
        cancelAtPeriodEnd: false,
        ...over,
    }) as BillingEvent

const invoiceEvent = (over: Record<string, unknown> = {}) =>
    ({
        kind: "invoice",
        teamId: null,
        customerId: "cus_1",
        subscriptionId: "sub_1",
        invoice: {
            stripeInvoiceId: "in_1",
            number: "UCL-0001",
            status: "paid",
            amountDue: 1900,
            amountPaid: 1900,
            currency: "usd",
            tier: "prowler",
            periodStart: "2026-08-01T00:00:00.000Z",
            periodEnd: "2026-09-01T00:00:00.000Z",
            hostedInvoiceUrl: null,
            invoicePdf: null,
            issuedAt: "2026-08-01T00:00:00.000Z",
            paidAt: "2026-08-01T00:00:05.000Z",
        },
        ...over,
    }) as BillingEvent

beforeEach(() => {
    subscriptions.applySubscription.mockReset().mockResolvedValue(undefined)
    subscriptions.findByStripeSubscription.mockReset().mockResolvedValue(null)
    subscriptions.findByStripeCustomer.mockReset().mockResolvedValue(null)
    invoices.upsert.mockReset().mockResolvedValue(undefined)
})

describe("subscription events", () => {
    test("a new subscription sets the tier, the status and the Stripe links", async () => {
        const outcome = await sync().apply(subEvent())
        expect(outcome).toMatchObject({ applied: true, teamId: "t1" })
        expect(subscriptions.applySubscription).toHaveBeenCalledWith("t1", {
            tier: "prowler",
            status: "active",
            stripe_customer_id: "cus_1",
            stripe_subscription_id: "sub_1",
            current_period_end: "2026-09-01T00:00:00.000Z",
            cancel_at_period_end: false,
        })
    })

    test("a failed payment lands as past_due, which is what drops the team to the "
        + "free allowance without any separate enforcement", async () => {
        await sync().apply(subEvent({ status: "past_due" }))
        expect(subscriptions.applySubscription.mock.calls[0][1]).toMatchObject({ status: "past_due" })
    })

    test("an UNRECOGNISED price leaves the tier alone — a subscription created "
        + "outside this app must not hand out an entitlement nobody chose", async () => {
        await sync().apply(subEvent({ tier: null }))
        expect(subscriptions.applySubscription.mock.calls[0][1]).not.toHaveProperty("tier")
    })

    test("cancel_at_period_end is recorded without changing entitlement — they "
        + "have paid through the period and keep the tier until it ends", async () => {
        await sync().apply(subEvent({ cancelAtPeriodEnd: true, status: "active" }))
        expect(subscriptions.applySubscription.mock.calls[0][1]).toMatchObject({
            status: "active",
            cancel_at_period_end: true,
            tier: "prowler",
        })
    })

    test("a deletion returns the team to the free tier and CLEARS the "
        + "subscription link, so a later purchase is not blocked by the unique "
        + "index — while keeping the customer, which holds the card", async () => {
        const outcome = await sync().apply({
            kind: "subscription_ended",
            teamId: "t1",
            customerId: "cus_1",
            subscriptionId: "sub_1",
        })
        expect(outcome).toMatchObject({ applied: true })
        const patch = subscriptions.applySubscription.mock.calls[0][1]
        expect(patch).toMatchObject({ tier: "kit", status: "canceled", stripe_subscription_id: null })
        expect(patch).not.toHaveProperty("stripe_customer_id")
    })

    test("applying the same event twice lands on the same state — Stripe "
        + "redelivers as a matter of course", async () => {
        await sync().apply(subEvent())
        await sync().apply(subEvent())
        expect(subscriptions.applySubscription.mock.calls[0]).toEqual(
            subscriptions.applySubscription.mock.calls[1],
        )
    })
})

describe("resolving which team an event is about", () => {
    test("metadata wins — it is the only source that reflects what the buyer "
        + "actually chose", async () => {
        await sync().apply(subEvent({ teamId: "t-meta" }))
        expect(subscriptions.applySubscription.mock.calls[0][0]).toBe("t-meta")
        expect(subscriptions.findByStripeSubscription).not.toHaveBeenCalled()
    })

    test("without metadata it resolves by subscription id — a link WE recorded, "
        + "so it cannot be spoofed by the payload", async () => {
        subscriptions.findByStripeSubscription.mockResolvedValue({ team_id: "t-linked" })
        await sync().apply(subEvent({ teamId: null }))
        expect(subscriptions.applySubscription.mock.calls[0][0]).toBe("t-linked")
    })

    test("then by customer id", async () => {
        subscriptions.findByStripeCustomer.mockResolvedValue({ team_id: "t-cust" })
        await sync().apply(subEvent({ teamId: null }))
        expect(subscriptions.applySubscription.mock.calls[0][0]).toBe("t-cust")
    })

    test("a subscription belonging to nobody is dropped, not retried — it is not "
        + "going to become resolvable", async () => {
        const outcome = await sync().apply(subEvent({ teamId: null }))
        expect(outcome).toMatchObject({ applied: false, retryable: false })
        expect(subscriptions.applySubscription).not.toHaveBeenCalled()
    })
})

describe("invoice events", () => {
    test("an invoice is mirrored against the team its subscription belongs to", async () => {
        subscriptions.findByStripeSubscription.mockResolvedValue({ team_id: "t1" })
        const outcome = await sync().apply(invoiceEvent())
        expect(outcome).toMatchObject({ applied: true, teamId: "t1" })
        expect(invoices.upsert).toHaveBeenCalledWith("t1", expect.objectContaining({ stripeInvoiceId: "in_1" }))
    })

    test("an invoice that names its own team is mirrored without the subscription "
        + "being known — one failed subscription write must not orphan every "
        + "invoice behind it", async () => {
        const outcome = await sync().apply(invoiceEvent({ teamId: "t-meta" }))
        expect(outcome).toMatchObject({ applied: true, teamId: "t-meta" })
        expect(subscriptions.findByStripeSubscription).not.toHaveBeenCalled()
        expect(invoices.upsert).toHaveBeenCalledWith("t-meta", expect.objectContaining({ stripeInvoiceId: "in_1" }))
    })

    test("an invoice that OVERTOOK its subscription is retryable, not dropped — "
        + "otherwise every new customer whose events raced loses their first "
        + "invoice permanently", async () => {
        const outcome = await sync().apply(invoiceEvent())
        expect(outcome).toMatchObject({ applied: false, retryable: true })
        expect(invoices.upsert).not.toHaveBeenCalled()
    })

    test("an invoice with no subscription still resolves by customer — proration "
        + "and one-off invoices arrive that way", async () => {
        subscriptions.findByStripeCustomer.mockResolvedValue({ team_id: "t1" })
        const outcome = await sync().apply(invoiceEvent({ subscriptionId: null }))
        expect(outcome).toMatchObject({ applied: true })
    })
})

describe("events we do not act on", () => {
    test("are acknowledged, not retried — Stripe resends anything unacknowledged, "
        + "and an event we ignore must not look like one we failed", async () => {
        const outcome = await sync().apply({ kind: "ignored", type: "charge.succeeded" })
        expect(outcome).toMatchObject({ applied: false, retryable: false })
    })
})
