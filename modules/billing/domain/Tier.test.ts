// The plan ladder is hand-edited config, and the kind of mistake it invites is
// not a type error — a tier that costs more and gives less, or one added to the
// catalogue but missing from TIER_IDS, both compile perfectly. These are the
// invariants a reader assumes when they look at the pricing table.

import { test, expect, describe } from "bun:test"
import { Tier, TIER_IDS, type TierId } from "./Tier"

const paid = TIER_IDS.map((id) => Tier.of(id)).filter((t) => t.spec.priceUsd !== null && t.spec.priceUsd > 0)

describe("the ladder", () => {
    test("every id in TIER_IDS resolves to its own tier — an entry missing from "
        + "the catalogue folds to Kit, which would silently sell the free plan", () => {
        for (const id of TIER_IDS) expect(Tier.of(id).id).toBe(id)
    })

    test("is ordered cheapest first, which is the order the pricing table renders", () => {
        const prices = TIER_IDS.map((id) => Tier.of(id).spec.priceUsd).filter((p): p is number => p !== null)
        expect(prices).toEqual([...prices].sort((a, b) => a - b))
    })

    test("paying more never buys fewer credits", () => {
        const points = paid.map((t) => t.monthlyPoints ?? Infinity)
        expect(points).toEqual([...points].sort((a, b) => a - b))
    })

    test("paying more never buys less concurrency", () => {
        const runs = paid.map((t) => t.concurrentRuns ?? Infinity)
        expect(runs).toEqual([...runs].sort((a, b) => a - b))
    })

    test("exactly one free tier, and it is the floor an unknown id folds to", () => {
        expect(TIER_IDS.filter((id) => Tier.of(id).isFree)).toEqual(["kit"])
        expect(Tier.of("no-such-tier").isFree).toBe(true)
    })

    test("only the top tier is uncapped — an uncapped tier in the middle of the "
        + "ladder would make every plan above it pointless", () => {
        const uncapped = TIER_IDS.filter((id) => Tier.of(id).isUncapped)
        expect(uncapped).toEqual([TIER_IDS[TIER_IDS.length - 1]])
    })

    test("every capped tier states a credit allowance and a concurrency cap", () => {
        for (const id of TIER_IDS) {
            const tier = Tier.of(id)
            if (tier.isUncapped) continue
            expect(tier.monthlyPoints).toBeGreaterThan(0)
            expect(tier.concurrentRuns).toBeGreaterThan(0)
        }
    })
})

describe("Scout (0087)", () => {
    const scout = Tier.of("scout" as TierId)

    test("sits between Kit and Prowler on price and on credits", () => {
        expect(scout.spec.priceUsd).toBe(5)
        expect(scout.monthlyPoints).toBeGreaterThan(Tier.of("kit").monthlyPoints ?? 0)
        expect(scout.monthlyPoints).toBeLessThan(Tier.of("prowler").monthlyPoints ?? 0)
    })

    test("holds the ladder's credits-per-dollar ratio rather than quietly "
        + "changing the economics — every paid tier here breaks even near 50% "
        + "utilisation because credits are sold at model cost", () => {
        for (const tier of paid) {
            const ratio = (tier.monthlyPoints ?? 0) / 1_000 / (tier.spec.priceUsd as number)
            expect(ratio).toBeGreaterThan(1.7)
            expect(ratio).toBeLessThan(2.3)
        }
    })
})
