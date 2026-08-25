// The upgrade quote. Every case here is money someone is charged, so the
// boundaries matter more than the happy path: rounding, overspend, free plans,
// and the plans that cannot be quoted at all.

import { test, expect, describe } from "bun:test"
import { quoteUpgrade } from "./UpgradeCredit"

describe("the worked example", () => {
    // Scout is $5 for 10,000 credits. 6,000 left is 60% of a month unused, so
    // 60% of $5 comes back and Prowler's $19 becomes $16.00.
    test("60% of a Scout month unused takes $3.00 off Prowler", () => {
        const q = quoteUpgrade("prowler", 6_000, "scout")
        expect(q.listCents).toBe(1900)
        expect(q.discountCents).toBe(300)
        expect(q.dueCents).toBe(1600)
        expect(q.creditsApplied).toBe(6_000)
    })
})

describe("the refund is priced against the plan being LEFT", () => {
    test("a FREE plan's leftovers are worth nothing — they were never paid for, "
        + "and refunding them was giving away money for credits we gave away", () => {
        const q = quoteUpgrade("prowler", 2_000, "kit")
        expect(q.discountCents).toBe(0)
        expect(q.dueCents).toBe(1900)
    })

    test("the same leftover is worth more when leaving a pricier plan, because "
        + "more was paid for it", () => {
        // 20% of a month unused, on two plans of different price.
        expect(quoteUpgrade("apex", 2_000, "scout").discountCents).toBe(0) // apex is unpriced
        expect(quoteUpgrade("pride", 2_000, "scout").discountCents).toBe(100) // 20% of $5
        expect(quoteUpgrade("pride", 8_000, "prowler").discountCents).toBe(380) // 20% of $19
    })
})

describe("boundaries", () => {
    test("no credits left means the full price", () => {
        expect(quoteUpgrade("prowler", 0, "scout").dueCents).toBe(1900)
    })

    test("a team that overspent is not surcharged", () => {
        expect(quoteUpgrade("prowler", -5_000, "scout").dueCents).toBe(1900)
    })

    test("a whole month unused refunds the whole month, and no more", () => {
        const q = quoteUpgrade("prowler", 10_000, "scout")
        expect(q.discountCents).toBe(500)
        expect(q.dueCents).toBe(1400)
    })

    test("holding MORE than the catalogue allowance — possible on a negotiated "
        + "override — still refunds at most one month", () => {
        expect(quoteUpgrade("prowler", 999_999, "scout").discountCents).toBe(500)
    })

    test("the refund never exceeds the new plan's price, so an invoice cannot go "
        + "negative", () => {
        const q = quoteUpgrade("scout", 150_000, "pride")
        expect(q.discountCents).toBe(q.listCents)
        expect(q.dueCents).toBe(0)
    })
})

describe("rounding", () => {
    test("rounds DOWN, so a rounding error never refunds more than was unused", () => {
        // One Scout credit is 0.05 cents.
        expect(quoteUpgrade("prowler", 1, "scout").discountCents).toBe(0)
    })

    test("the parts always reconcile — list = discount + due, in integers", () => {
        for (const credits of [0, 1, 999, 6_000, 9_999, 10_000, 1_000_000]) {
            const q = quoteUpgrade("prowler", credits, "scout")
            expect(q.discountCents + q.dueCents).toBe(q.listCents)
            expect(Number.isInteger(q.discountCents)).toBe(true)
        }
    })

    test("a fractional credit count cannot smuggle in a fractional cent", () => {
        expect(Number.isInteger(quoteUpgrade("prowler", 6_000.7, "scout").discountCents)).toBe(true)
    })
})

describe("plans that cannot be quoted", () => {
    test("moving TO Apex quotes nothing — it is unpriced and sold by hand", () => {
        expect(quoteUpgrade("apex", 6_000, "scout")).toEqual({
            listCents: 0, discountCents: 0, dueCents: 0, creditsApplied: 0,
        })
    })

    test("leaving an UNCAPPED plan refunds nothing — there is no allowance to "
        + "take a fraction of", () => {
        expect(quoteUpgrade("prowler", 6_000, "apex").discountCents).toBe(0)
    })

    test("an unknown current tier folds to the free floor, so it refunds nothing "
        + "rather than guessing", () => {
        expect(quoteUpgrade("prowler", 6_000, "no-such-plan").discountCents).toBe(0)
    })
})
