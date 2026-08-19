import { test, expect, describe } from "bun:test"
import { PullRequestAnalysisComment } from "./PullRequestAnalysisComment"
import { BLOCK_KINDS, CLASSIC_LAYOUT, type ReportBlock } from "@/lib/shared/report/registry"
import type { PrAnalysis } from "@/lib/shared/types"

// The GitHub comment is now assembled by walking a LAYOUT rather than a fixed
// field list. That is a refactor of how it's built, not of what it says, so the
// tests that matter here are the ones pinning it to what it said before —
// especially for the years of stored reviews that carry no layout at all.

const ORIGIN = "https://ucelot.test"
const UI = "https://ucelot.test/projects/p1/pulls/7"

function analysis(over: Partial<PrAnalysis> = {}): PrAnalysis {
    return {
        title: "Add the widget",
        summary: "- adds a widget\n- wires it to the bus",
        impact: "- callers of renderWidget may need updating",
        impact_files: [{ file: "bus.ts", reason: "calls renderWidget" }],
        findings: [
            { file: "a.ts", line: 12, severity: "critical", category: "bug", title: "Nil deref", detail: "x may be null", snippet: "- old\n+ new", lang: "diff" },
            { file: "b.ts", line: 4, severity: "review", category: "convention", title: "Bare error", detail: "wrap it" },
            { file: "c.ts", severity: "good", category: "good", title: "Good test", detail: "covers the edge" },
        ],
        fix_claims: [{ claim: "fixes the crash", verdict: "likely", reason: "guards the path" }],
        checklist: ["give the empty-config path a glance"],
        confidences: {
            correctness: { level: "medium", basis: "read 3 callers" },
            load_perf: { level: "low", basis: "nothing perf-critical" },
            security: { level: "low", basis: "no untrusted input" },
        },
        checks: { precedents: 2, callers: 3, tests: 1, git_reads: 1, failure_probes: 1 },
        verdict: "request_changes",
        verdict_reason: "one blocker",
        score: 4,
        score_max: 10,
        duration_ms: 12_300,
        insight_id: "ins_1",
        ...over,
    }
}

describe("PR comment: layout-driven rendering", () => {
    const c = new PullRequestAnalysisComment()

    test("a legacy review with no layout renders the classic comment", () => {
        const body = c.result(analysis(), ORIGIN, UI, 7)

        // The frame.
        expect(body).toStartWith("<!-- bobby:pr-analysis -->")
        expect(body).toContain("## PR Review (Add the widget)")
        expect(body).toContain("_one blocker_")
        expect(body).toContain("### Quick Summary")
        expect(body).toContain("**Merge Readiness**")
        expect(body).toContain("**Analysis rubrics**")
        expect(body).toContain("**About this PR**")
        expect(body).toContain("### Ucelot Notes")
        expect(body).toContain("Bug: Nil deref")
        expect(body).toContain("Convention: Bare error")
        expect(body).toContain("fixes the crash")
        expect(body).toContain("View the full review in ucelot")
        expect(body).toContain("Ucelot is AI-assisted and can make mistakes")
    })

    test("an explicit classic layout renders identically to no layout at all", () => {
        // The guarantee that makes phase 0 safe: the classic block list IS the
        // old fixed order, so a review carrying it and a legacy row without one
        // must produce the same bytes.
        const withLayout = c.result(analysis({ report: { version: 1, blocks: CLASSIC_LAYOUT } }), ORIGIN, UI, 7)
        const withNone = c.result(analysis(), ORIGIN, UI, 7)
        expect(withLayout).toBe(withNone)
    })

    test("the changed-code section follows the findings, not the fix claims", () => {
        const body = c.result(analysis(), ORIGIN, UI, 7)
        const snippets = body.indexOf("Changed code")
        const claims = body.indexOf("Fix claims")
        expect(snippets).toBeGreaterThan(-1)
        expect(claims).toBeGreaterThan(-1)
        expect(snippets).toBeLessThan(claims)
    })

    test("app-only blocks stay app-only", () => {
        // The checklist and the diligence ledger have never appeared on GitHub.
        // Adding them is a product call; this pins that it hasn't happened by
        // accident on the way through the registry.
        const body = c.result(analysis(), ORIGIN, UI, 7)
        expect(body).not.toContain("give the empty-config path a glance")
        expect(body).not.toContain("Checked 3 callers")
    })

    test("sections appear where their blocks land, not at fixed positions", () => {
        // Findings first, summary after — the headings follow.
        const report = {
            version: 1,
            blocks: [
                { kind: "verdict_banner" },
                { kind: "finding_group", state: "critical" },
                { kind: "prose", role: "summary" },
            ] as ReportBlock[],
        }
        const body = c.result(analysis({ report }), ORIGIN, UI, 7)
        expect(body.indexOf("### Ucelot Notes")).toBeLessThan(body.indexOf("### Quick Summary"))
    })

    test("a layout of kinds this tracker doesn't know still renders the frame", () => {
        const report = { version: 99, blocks: [{ kind: "hologram" }, { kind: "verdict_banner" }] as unknown as ReportBlock[] }
        const body = c.result(analysis({ report }), ORIGIN, UI, 7)
        expect(body).toContain("## PR Review (Add the widget)")
        expect(body).toContain("Ucelot is AI-assisted")
        expect(body).not.toContain("hologram")
    })

    test("an empty review renders a comment, not a skeleton of empty sections", () => {
        const bare: PrAnalysis = { summary: "", impact: "", verdict: "approve", verdict_reason: "looks safe" }
        const body = c.result(bare, ORIGIN, UI, 7)
        expect(body).toContain("looks safe")
        expect(body).not.toContain("### Ucelot Notes")
        expect(body).not.toContain("Changed code")
    })

    test("inline blocks render their own payload", () => {
        const report = {
            version: 1,
            blocks: [
                { kind: "callout", tone: "critical", title: "Untrusted input reaches exec", body: "See `a.ts:12`." },
                { kind: "spec_table", title: "Contract changes", columns: ["Symbol", "Before", "After"], rows: [["getBase", "T", "T | null"]] },
                { kind: "dependency_list", items: [{ label: "left-pad", from: "1.0.0", to: "2.0.0", detail: "major bump" }] },
            ] as ReportBlock[],
        }
        const body = c.result(analysis({ report }), ORIGIN, UI, 7)
        expect(body).toContain("See `a.ts:12`.")
        expect(body).toContain("| Symbol | Before | After |")
        expect(body).toContain("| getBase | T | T \\| null |") // pipes escaped, or the table breaks
        expect(body).toContain("left-pad")
    })
})

describe("PR comment: registry coverage", () => {
    test("every registered kind is renderable without throwing", () => {
        // The Record<BlockKind, …> typing already makes a MISSING renderer a
        // compile error. This covers the other half: that each one survives a
        // block with nothing in it, which is what a model will eventually send.
        const c = new PullRequestAnalysisComment()
        for (const kind of BLOCK_KINDS) {
            const report = { version: 1, blocks: [{ kind }] as ReportBlock[] }
            expect(() => c.result(analysis({ report }), ORIGIN, UI, 7)).not.toThrow()
            expect(() => c.result({ summary: "", impact: "", report }, ORIGIN, UI, 7)).not.toThrow()
        }
    })
})
