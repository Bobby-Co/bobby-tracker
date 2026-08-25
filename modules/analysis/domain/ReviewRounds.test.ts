import { test, expect, describe } from "bun:test"
import { fingerprint, normaliseTitle, titleSimilarity, diffRounds, progressLine } from "./ReviewRounds"
import type { PrFinding } from "@/lib/shared/types"

const f = (over: Partial<PrFinding> = {}): PrFinding => ({
    file: "src/tasks/infra/search-repo.ts",
    line: 12,
    severity: "critical",
    category: "security",
    title: "SQL injection in searchTasks",
    detail: "interpolates owner into the query",
    ...over,
})

describe("fingerprint", () => {
    // The whole point: a fix ABOVE a finding moves it without changing it.
    test("survives the line moving", () => {
        expect(fingerprint(f({ line: 12 }))).toBe(fingerprint(f({ line: 48 })))
    })

    test("distinguishes the same title in different files", () => {
        expect(fingerprint(f())).not.toBe(fingerprint(f({ file: "src/other.ts" })))
    })

    test("distinguishes different categories in one file", () => {
        expect(fingerprint(f())).not.toBe(fingerprint(f({ category: "performance" })))
    })

    test("falls back to the detail when a finding has no title", () => {
        expect(fingerprint(f({ title: undefined }))).toContain("interpolates owner")
    })
})

describe("normaliseTitle", () => {
    // The reviewer rewords itself between rounds; this is what absorbs it.
    test("drops a leading category tag", () => {
        expect(normaliseTitle("Security: SQL injection")).toBe("sql injection")
    })

    test("is punctuation- and case-insensitive", () => {
        expect(normaliseTitle("SQL Injection, in searchTasks()")).toBe(normaliseTitle("sql injection in searchtasks"))
    })
})

describe("titleSimilarity", () => {
    test("a rewording of the same defect scores high", () => {
        expect(titleSimilarity(
            "SQL injection in searchTasks",
            "Security: unparameterised SQL in searchTasks",
        )).toBeGreaterThanOrEqual(0.6)
    })

    test("two different defects in one file score low", () => {
        expect(titleSimilarity("SQL injection in searchTasks", "Missing index on task_search")).toBeLessThan(0.6)
    })

    test("an empty title matches nothing", () => {
        expect(titleSimilarity("", "anything at all")).toBe(0)
    })
})

describe("diffRounds", () => {
    test("the first review is all new, and resolves nothing", () => {
        const d = diffRounds({ headSha: "a", findings: [f()] }, null)
        expect(d.current[0].delta).toBe("new")
        expect(d.counts).toEqual({ fixed: 0, stillOpen: 0, new: 1, regressed: 0 })
    })

    test("a finding named again is still open, not new", () => {
        const d = diffRounds({ headSha: "b", findings: [f({ line: 40 })] }, { headSha: "a", findings: [f()] })
        expect(d.current[0].delta).toBe("still_open")
        expect(d.counts.fixed).toBe(0)
    })

    test("a blocker that disappeared is fixed", () => {
        const d = diffRounds({ headSha: "b", findings: [] }, { headSha: "a", findings: [f()] })
        expect(d.fixed).toHaveLength(1)
        expect(d.counts.fixed).toBe(1)
    })

    test("a reworded finding is matched, not double-counted", () => {
        const d = diffRounds(
            { headSha: "b", findings: [f({ title: "Security: unparameterised SQL in searchTasks" })] },
            { headSha: "a", findings: [f({ title: "SQL injection in searchTasks" })] },
        )
        expect(d.current[0].delta).toBe("still_open")
        expect(d.counts.fixed).toBe(0)
        expect(d.counts.new).toBe(0)
    })

    test("a finding fixed earlier and back again is a regression", () => {
        const d = diffRounds(
            { headSha: "c", findings: [f()] },
            { headSha: "b", findings: [] },
            [{ headSha: "a", findings: [f()] }],
        )
        expect(d.current[0].delta).toBe("regressed")
        expect(d.counts.regressed).toBe(1)
    })

    // Positives vanishing is not an achievement, and counting them would inflate
    // the progress line with things nobody set out to do.
    test("only blockers count as fixed", () => {
        const good = f({ severity: "good", title: "nice test coverage", category: "good" })
        const d = diffRounds({ headSha: "b", findings: [] }, { headSha: "a", findings: [good] })
        expect(d.counts.fixed).toBe(0)
    })

    // The rule the whole design rests on.
    test("a DEGRADED round resolves nothing", () => {
        const d = diffRounds(
            { headSha: "b", findings: [], degraded: true },
            { headSha: "a", findings: [f()] },
        )
        expect(d.fixed).toHaveLength(0)
        expect(d.counts.fixed).toBe(0)
        expect(d.withheld).toBe(true)
    })

    test("a degraded round still reports what it DID find", () => {
        const d = diffRounds(
            { headSha: "b", findings: [f()], degraded: true },
            { headSha: "a", findings: [f()] },
        )
        expect(d.current[0].delta).toBe("still_open")
    })
})

describe("progressLine", () => {
    test("counts what was fixed against what it started with", () => {
        const d = diffRounds({ headSha: "b", findings: [f({ file: "src/a.ts" })] },
            { headSha: "a", findings: [f(), f({ file: "src/a.ts" })] })
        expect(progressLine(d, 1)).toBe("1 of 2 blockers resolved, 1 remain")
    })

    test("says so plainly when the last one clears", () => {
        const d = diffRounds({ headSha: "b", findings: [] }, { headSha: "a", findings: [f()] })
        expect(progressLine(d, 0)).toBe("all 1 blocker resolved")
    })

    test("a first review has no progress to report", () => {
        expect(progressLine(diffRounds({ headSha: "a", findings: [f()] }, null), 1)).toBeNull()
    })

    test("a degraded round says why it is not counting", () => {
        const d = diffRounds({ headSha: "b", findings: [], degraded: true }, { headSha: "a", findings: [f()] })
        expect(progressLine(d, 0)).toContain("did not complete")
    })
})
