import { test, expect, describe } from "bun:test"
import { MergePolicy } from "./MergeGate"
import type { MergePull, MergeReview, MergeMethods } from "./MergeGate"

const policy = new MergePolicy()
const mergeGate = (pull: MergePull, analysis: MergeReview | null) => policy.evaluate(pull, analysis)
const criticalFindingCount = (a: MergeReview | null) => policy.criticalFindingCount(a)
const defaultMergeMethod = (m: MergeMethods) => policy.defaultMethod(m)

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

// ─── a partial review has not cleared anything (0080) ───────────────────────
//
// This is the only gate that fires on an ABSENCE. Every other rule reads what
// the review found; this one reads that it did not finish looking — because an
// empty blocker list from a degraded review means "we did not look", and the
// analyser degrading silently is precisely how a pull request with three
// injections once scored 10/10.
describe("MergePolicy: a degraded review", () => {
    const policy = new MergePolicy()
    const open = { merged: false, state: "open" as const, draft: false }

    test("holds the merge even with no blockers", () => {
        const gate = policy.evaluate(open, { status: "done", result: { findings: [], degraded: true } })
        expect(gate.mergeable).toBe(false)
        expect(gate.block?.code).toBe("review_partial")
    })

    test("says re-running will clear it", () => {
        const gate = policy.evaluate(open, { status: "done", result: { findings: [], degraded: true } })
        expect(gate.block?.transient).toBe(true)
        expect(gate.block?.label).toContain("re-run")
    })

    // Blockers still take precedence: a partial review that DID find something
    // must report the finding, not the incompleteness.
    test("a blocker it did find still leads", () => {
        const gate = policy.evaluate(open, {
            status: "done",
            result: { findings: [{ severity: "critical" }], degraded: true },
        })
        expect(gate.block?.code).toBe("critical")
    })

    test("a complete review with no blockers still merges", () => {
        expect(policy.evaluate(open, { status: "done", result: { findings: [] } }).mergeable).toBe(true)
    })

    // Rows written before the analyser reported it are treated as complete,
    // because that is what they were.
    test("a legacy row without the flag is not treated as partial", () => {
        expect(policy.evaluate(open, { status: "done", result: { findings: [] } }).mergeable).toBe(true)
    })
})

describe("MergePolicy: progress wording", () => {
    const policy = new MergePolicy()
    const open = { merged: false, state: "open" as const, draft: false }
    const twoBlockers = { status: "done" as const, result: { findings: [{ severity: "critical" }, { severity: "critical" }] } }

    test("counts progress when the previous round had more", () => {
        const gate = policy.evaluate(open, twoBlockers, { fixed: 3 })
        expect(gate.block?.label).toBe("3 of 5 blockers resolved — 2 left")
    })

    test("falls back to the plain count with no progress to report", () => {
        expect(policy.evaluate(open, twoBlockers).block?.label).toBe("Review found 2 blockers")
        expect(policy.evaluate(open, twoBlockers, { fixed: 0 }).block?.label).toBe("Review found 2 blockers")
    })

    // Wording only — the decision is still the findings.
    test("progress never changes mergeability", () => {
        expect(policy.evaluate(open, twoBlockers, { fixed: 99 }).mergeable).toBe(false)
        expect(policy.evaluate(open, twoBlockers, { fixed: 99 }).criticalCount).toBe(2)
    })
})
