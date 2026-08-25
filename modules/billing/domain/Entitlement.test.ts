// What a team may use, as opposed to what it bought. This is where "a failed
// payment means no top-up" actually lives, so the unpaid cases matter more than
// the happy one.

import { test, expect, describe } from "bun:test"
import { entitledTier, isPaidUp, FREE_TIER_ID } from "./Entitlement"
import { payAsYouGoEligible } from "./PayAsYouGo"

describe("entitledTier", () => {
    test("a paid-up team gets the tier it bought", () => {
        expect(entitledTier("pride", "active").id).toBe("pride")
    })

    test("a PAST DUE team falls back to the free tier — the month it did not pay "
        + "for is a month whose credits were never bought", () => {
        expect(entitledTier("pride", "past_due").id).toBe(FREE_TIER_ID)
    })

    test("...and so does a canceled one", () => {
        expect(entitledTier("prowler", "canceled").id).toBe(FREE_TIER_ID)
    })

    test("...and a suspended one", () => {
        expect(entitledTier("prowler", "suspended").id).toBe(FREE_TIER_ID)
    })

    test("the fallback is the FREE tier, not nothing — an expired card should "
        + "cost a team its paid allowance, not its access to the product", () => {
        const fallback = entitledTier("apex", "past_due")
        expect(fallback.monthlyPoints).toBeGreaterThan(0)
        expect(fallback.isUncapped).toBe(false)
    })

    test("a free plan is unaffected by billing status — there is nothing it could "
        + "have failed to pay", () => {
        expect(entitledTier("kit", "past_due").id).toBe("kit")
        expect(entitledTier("kit", "canceled").id).toBe("kit")
    })

    test("an unknown tier folds to the free floor rather than throwing", () => {
        expect(entitledTier("enterprise-platinum", "active").id).toBe(FREE_TIER_ID)
    })

    test("a missing status reads as unpaid for a PAID plan — a row we cannot read "
        + "a status from must not hand out a paid entitlement", () => {
        expect(entitledTier("pride", null).id).toBe(FREE_TIER_ID)
    })
})

describe("isPaidUp", () => {
    test("only 'active' counts", () => {
        expect(isPaidUp("active")).toBe(true)
        for (const status of ["past_due", "canceled", "suspended", "", null, undefined]) {
            expect(isPaidUp(status)).toBe(false)
        }
    })
})

describe("payAsYouGoEligible (feature is OFF; the rule is still pinned)", () => {
    test("a paid-up paid plan qualifies", () => {
        expect(payAsYouGoEligible("prowler", "active")).toBe(true)
    })

    test("the FREE tier does not — otherwise topping up becomes a way around "
        + "subscribing at all", () => {
        expect(payAsYouGoEligible("kit", "active")).toBe(false)
    })

    test("a past-due team does not — that is buying credits on a card that has "
        + "just failed", () => {
        expect(payAsYouGoEligible("pride", "past_due")).toBe(false)
    })
})
