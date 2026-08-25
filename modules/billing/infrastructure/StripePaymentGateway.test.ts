// The Stripe adapter's CONFIGURATION behaviour — the part that decides whether a
// plan can be bought at all, and the part that is easiest to get wrong in a fresh
// environment. Everything that talks to Stripe over the network is deliberately
// not covered here; this pins what happens BEFORE any call is made.
//
// It also serves as an import smoke test: the SDK is loaded at module scope, so a
// packaging problem shows up here rather than at runtime on the first checkout.

import { test, expect, describe, beforeEach, afterEach } from "bun:test"
import { createStripePaymentGateway } from "./StripePaymentGateway"

const saved = { ...process.env }

beforeEach(() => {
    delete process.env.STRIPE_PRICE_PROWLER
    delete process.env.STRIPE_PRICE_PRIDE
})
afterEach(() => {
    process.env = { ...saved }
})

describe("isPurchasable", () => {
    test("a tier with a configured price can be bought", () => {
        process.env.STRIPE_PRICE_PROWLER = "price_123"
        expect(createStripePaymentGateway().isPurchasable("prowler")).toBe(true)
    })

    test("a tier with NO configured price cannot — a missing env var should show "
        + "up as a disabled button, not as a Stripe error mid-checkout", () => {
        expect(createStripePaymentGateway().isPurchasable("prowler")).toBe(false)
    })

    test("an empty price id counts as unconfigured, not as a price — a blank line "
        + "in a .env file is the most likely way this is set wrong", () => {
        process.env.STRIPE_PRICE_PROWLER = "   "
        expect(createStripePaymentGateway().isPurchasable("prowler")).toBe(false)
    })

    test("Apex is never purchasable — it is priced 'Custom', so there is nothing "
        + "to check out even if someone configures a price for it", () => {
        process.env.STRIPE_PRICE_APEX = "price_apex"
        expect(createStripePaymentGateway().isPurchasable("apex")).toBe(false)
        delete process.env.STRIPE_PRICE_APEX
    })

    test("the free tier is not purchasable either", () => {
        expect(createStripePaymentGateway().isPurchasable("kit")).toBe(false)
    })
})

describe("createCheckoutSession", () => {
    test("refuses before making a network call when the tier has no price", () => {
        expect(
            createStripePaymentGateway().createCheckoutSession({
                teamId: "t1",
                tier: "prowler",
                customerId: null,
                customerEmail: null,
                successUrl: "https://app/ok",
                cancelUrl: "https://app/no",
            }),
        ).rejects.toThrow(/no Stripe price configured/)
    })
})
