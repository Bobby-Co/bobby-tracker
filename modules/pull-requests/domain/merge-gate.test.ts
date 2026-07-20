import { test, expect, describe } from "bun:test"
import { mergeGate, criticalFindingCount, defaultMergeMethod } from "./merge-gate"
import type { MergePull, MergeReview } from "./merge-gate"

// Characterization tests — lock in the CURRENT behaviour of the merge gate so a
// later data/ownership refactor can't silently change what may be merged.

const openPull: MergePull = { merged: false, state: "open", draft: false }
const done = (findings: { severity: string }[] = []): MergeReview => ({
    status: "done",
    result: { findings },
})

describe("mergeGate — PR lifecycle blocks", () => {
    test("a merged PR is blocked as 'merged'", () => {
        const g = mergeGate({ ...openPull, merged: true }, done())
        expect(g.mergeable).toBe(false)
        expect(g.block?.code).toBe("merged")
    })
    test("a closed (unmerged) PR is blocked as 'closed'", () => {
        const g = mergeGate({ ...openPull, state: "closed" }, done())
        expect(g.block?.code).toBe("closed")
    })
    test("a draft PR is blocked as 'draft'", () => {
        const g = mergeGate({ ...openPull, draft: true }, done())
        expect(g.block?.code).toBe("draft")
    })
})

describe("mergeGate — review gate", () => {
    test("no review → 'no_review', transient", () => {
        const g = mergeGate(openPull, null)
        expect(g.block?.code).toBe("no_review")
        expect(g.block?.transient).toBe(true)
    })
    test("null status → 'no_review'", () => {
        const g = mergeGate(openPull, { status: null, result: null })
        expect(g.block?.code).toBe("no_review")
    })
    test("in-progress review → 'review_pending', transient", () => {
        const g = mergeGate(openPull, { status: "analysing", result: null })
        expect(g.block?.code).toBe("review_pending")
        expect(g.block?.transient).toBe(true)
    })
    test("failed review → 'review_incomplete', not transient", () => {
        const g = mergeGate(openPull, { status: "failed", result: null })
        expect(g.block?.code).toBe("review_incomplete")
        expect(g.block?.transient).toBe(false)
    })
    test("cancelled review → 'review_incomplete'", () => {
        const g = mergeGate(openPull, { status: "cancelled", result: null })
        expect(g.block?.code).toBe("review_incomplete")
    })
})

describe("mergeGate — the critical-finding rule (merge safety)", () => {
    test("a clean finished review is mergeable", () => {
        const g = mergeGate(openPull, done([{ severity: "review" }, { severity: "good" }]))
        expect(g.mergeable).toBe(true)
        expect(g.block).toBeNull()
        expect(g.criticalCount).toBe(0)
    })
    test("a critical finding blocks with an accurate count", () => {
        const g = mergeGate(openPull, done([{ severity: "critical" }, { severity: "bug" }, { severity: "style" }]))
        expect(g.mergeable).toBe(false)
        expect(g.block?.code).toBe("critical")
        expect(g.criticalCount).toBe(2) // both critical AND bug classify as critical
        expect(g.block?.label).toContain("2 blockers")
    })
    test("single blocker uses singular wording", () => {
        const g = mergeGate(openPull, done([{ severity: "bug" }]))
        expect(g.block?.label).toContain("1 blocker")
        expect(g.block?.label).not.toContain("blockers")
    })
})

describe("criticalFindingCount", () => {
    test("counts only critical/bug severities; null-safe", () => {
        expect(criticalFindingCount(null)).toBe(0)
        expect(criticalFindingCount({ status: "done", result: null })).toBe(0)
        expect(
            criticalFindingCount(done([{ severity: "critical" }, { severity: "bug" }, { severity: "nit" }])),
        ).toBe(2)
    })
})

describe("defaultMergeMethod — GitHub preference order", () => {
    test("merge > squash > rebase, null when none", () => {
        expect(defaultMergeMethod({ merge: true, squash: true, rebase: true })).toBe("merge")
        expect(defaultMergeMethod({ merge: false, squash: true, rebase: true })).toBe("squash")
        expect(defaultMergeMethod({ merge: false, squash: false, rebase: true })).toBe("rebase")
        expect(defaultMergeMethod({ merge: false, squash: false, rebase: false })).toBeNull()
    })
})
