import { describe, expect, it } from "bun:test"
import { pointsForUsage, pointsFromCostUsd, pointsFromTokens, formatPoints } from "./ProwlPoints"
import { Balance } from "./Balance"
import { Tier } from "./Tier"

describe("ProwlPoints", () => {
    it("charges from dollar cost, rounding up so a non-zero call is never free", () => {
        expect(pointsFromCostUsd(0.0123)).toBe(13) // ceil(12.3)
        expect(pointsFromCostUsd(0.0000001)).toBe(1)
        expect(pointsFromCostUsd(1)).toBe(1000)
    })

    it("floors bad/zero cost to zero", () => {
        expect(pointsFromCostUsd(0)).toBe(0)
        expect(pointsFromCostUsd(-5)).toBe(0)
        expect(pointsFromCostUsd(NaN)).toBe(0)
        expect(pointsFromCostUsd(null)).toBe(0)
    })

    it("falls back to tokens only when there is no dollar cost", () => {
        expect(pointsForUsage({ costUsd: 0.01, totalTokens: 999999 })).toBe(10) // cost wins
        expect(pointsForUsage({ totalTokens: 3200 })).toBe(pointsFromTokens(3200))
        expect(pointsForUsage({ inputTokens: 1000, outputTokens: 1000 })).toBe(2)
    })

    it("formats compactly", () => {
        expect(formatPoints(2000)).toBe("2,000")
        expect(formatPoints(40000)).toBe("40k")
        expect(formatPoints(1_500_000)).toBe("1.5M")
    })
})

describe("Balance", () => {
    it("computes remaining and fraction against the tier allowance", () => {
        const b = new Balance({ tier: "kit", used: 500, periodStart: "2026-08-01T00:00:00.000Z" })
        expect(b.allowance).toBe(2000)
        expect(b.remaining).toBe(1500)
        expect(b.fraction).toBeCloseTo(0.25)
        expect(b.isExhausted).toBe(false)
        expect(b.periodEnd).toBe("2026-09-01T00:00:00.000Z")
    })

    it("honours a per-team allowance override on a capped tier", () => {
        const b = new Balance({ tier: "pride", allowanceOverride: 500_000, used: 500_000, periodStart: "2026-08-01T00:00:00.000Z" })
        expect(b.allowance).toBe(500_000)
        expect(b.remaining).toBe(0)
        expect(b.isExhausted).toBe(true)
    })

    it("treats Apex as uncapped regardless of override", () => {
        const b = new Balance({ tier: "apex", allowanceOverride: 10, used: 9_999_999, periodStart: "2026-08-01T00:00:00.000Z" })
        expect(b.allowance).toBeNull()
        expect(b.remaining).toBeNull()
        expect(b.isExhausted).toBe(false)
        expect(Tier.of("apex").isUncapped).toBe(true)
    })

    it("folds an unknown tier id to Kit (safe floor)", () => {
        expect(Tier.of("platinum").id).toBe("kit")
        expect(Tier.of(null).id).toBe("kit")
    })
})
