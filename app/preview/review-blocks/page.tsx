"use client"

import { useState } from "react"
import { PrReview } from "@/components/pulls/pr-review"
import { CLASSIC_LAYOUT, type ReportBlock } from "@/lib/shared/report/registry"
import type { PrAnalysis, PullRequestAnalysis, ReviewRunProfile } from "@/lib/shared/types"

// Preview harness for the report-block renderer (analyser ADR-0066).
//
// The review panel is the hardest surface in the app to see: it needs a signed-in
// user, a connected repo, an indexed graph and an actual pull request before it
// renders a single pixel. That made every change to it a change made blind. This
// page renders the SAME component against a fixture, through each of the layouts
// a profile can produce — which is also the closest thing to the "what will my
// profile look like" preview the settings page eventually wants.
//
// Fixture data only. Nothing here reaches the network.

const FIXTURE: PrAnalysis = {
    title: "Bind the region before purging regional content",
    summary:
        "- Resolves the project's cell before deleting its regional rows, so a purge can't run against the home database\n" +
        "- Moves the binding above the first regional read, which is where it was actually needed",
    impact:
        "- `ProjectDeletionService` now fails closed when a cell can't be resolved\n" +
        "- Two callers pass a project id that may not be bound yet",
    impact_files: [
        { file: "modules/projects/application/ProjectDeletionService.ts", reason: "binds the cell before the purge" },
        { file: "app/api/projects/[id]/route.ts", reason: "calls the deletion service" },
    ],
    findings: [
        {
            file: "modules/projects/application/ProjectDeletionService.ts",
            line: 88,
            severity: "critical",
            category: "bug",
            title: "Unbound cell falls through to the home database",
            detail: "findCell returns null for a project created before 0062; the purge then runs against whatever the context is already bound to.",
            evidence: [
                { file: "modules/projects/application/ProjectDeletionService.ts", line: 88, kind: "code", note: "the unguarded call" },
                { file: "lib/server/http/RequestContext.ts", line: 141, kind: "caller", note: "binds lazily, so null means home" },
            ],
            checked: ["enumerated 2 callers via get_neighbors(in)", "read the binding path"],
            snippet: "-    const cell = await this.projects.findCell(id)\n+    const cell = await this.projects.findCell(id)\n+    if (!cell) throw new Error('unbound project')",
            lang: "diff",
        },
        {
            file: "modules/projects/application/ProjectDeletionService.ts",
            line: 140,
            severity: "review",
            category: "test_gap",
            title: "No test covers the unbound path",
            detail: "ProjectDeletionService.test.ts covers the happy path and the suggestion-cleanup failure, but not a null cell.",
            evidence: [{ file: "modules/projects/application/ProjectDeletionService.test.ts", line: 1, kind: "test", note: "no case for a null cell" }],
            checked: ["ripgrep for findCell in the test file"],
        },
        {
            file: "modules/projects/application/ProjectDeletionService.ts",
            line: 60,
            severity: "good",
            category: "good",
            title: "Fails closed rather than guessing",
            detail: "Throwing beats defaulting to the home cell — a wrong purge is unrecoverable.",
        },
    ],
    fix_claims: [{ claim: "fixes deletion against the wrong region", verdict: "likely", reason: "the binding now precedes every regional read" }],
    checklist: ["confirm projects created before 0062 all have a cell", "check the delete path in staging against a region-2 project"],
    confidences: {
        correctness: { level: "medium", basis: "read 2 callers and the binding path" },
        load_perf: { level: "low", basis: "no perf-critical path inspected" },
        security: { level: "low", basis: "no untrusted input in this diff" },
    },
    checks: { precedents: 2, callers: 2, tests: 1, git_reads: 1, failure_probes: 1, dropped: 1 },
    verdict: "request_changes",
    verdict_reason: "one unguarded path can purge the wrong database",
    score: 4,
    score_max: 10,
    duration_ms: 41_200,
    insight_id: "ins_preview",
    analyser_build: "af71ce4",
}

// The layouts a profile can produce, as the analyser's assembler would emit them.
const LAYOUTS: { key: string; label: string; note: string; blocks: ReportBlock[] | null }[] = [
    {
        key: "classic",
        label: "Default",
        note: "What every review looked like before profiles, and what a legacy row with no layout still gets.",
        blocks: null,
    },
    {
        key: "security",
        label: "Security hawk",
        note: "The security lens leads with its risk matrix and puts the security meter first.",
        blocks: [
            { kind: "verdict_banner" },
            {
                kind: "risk_matrix",
                title: "Risks",
                items: [
                    { label: "Purge runs against the home database", likelihood: "medium", impact: "high", detail: "An unbound project id reaches the regional delete with no cell resolved." },
                    { label: "Partial delete leaves orphaned rows", likelihood: "low", impact: "medium", detail: "The purge aborts mid-way if the first regional read throws." },
                ],
            },
            { kind: "callout", tone: "critical", title: "Unbound projects reach a destructive path", body: "Projects created before migration 0062 have no cell. `findCell` returns null and the delete proceeds against whatever the context is bound to." },
            { kind: "score" },
            { kind: "meters", dims: ["security", "correctness", "load_perf"] },
            { kind: "prose", role: "summary" },
            { kind: "finding_group", state: "critical" },
            { kind: "finding_group", state: "review" },
            { kind: "checks_footer" },
            { kind: "deep_dive_cta" },
        ],
    },
    {
        key: "ship_fast",
        label: "Ship fast",
        note: "Verdict, blockers, nothing else. No positives, no checklist, no impact narrative.",
        blocks: [
            { kind: "verdict_banner" },
            { kind: "score" },
            { kind: "finding_group", state: "critical" },
            { kind: "deep_dive_cta" },
        ],
    },
    {
        key: "contract",
        label: "API contract",
        note: "The contract lens emits a spec table; the history lens emits a timeline.",
        blocks: [
            { kind: "verdict_banner" },
            {
                kind: "spec_table",
                title: "Contract changes",
                columns: ["Symbol", "Before", "After", "Callers"],
                rows: [
                    ["ProjectDeletionService.delete", "(id: string)", "(id: string) throws", "2"],
                    ["ProjectsRepository.findCell", "string", "string | null", "5"],
                ],
            },
            {
                kind: "timeline",
                title: "History",
                items: [
                    { when: "6dacdc6", label: "fix(delete): bind the region before purging", detail: "the change under review" },
                    { when: "0062", label: "project region added", detail: "projects created before this have no cell" },
                ],
            },
            { kind: "prose", role: "summary" },
            { kind: "prose", role: "impact" },
            { kind: "file_impact_list" },
            { kind: "finding_group", state: "critical" },
            { kind: "claims_table" },
            { kind: "checks_footer" },
        ],
    },
    {
        // Every kind in the registry, in one panel. Not a layout any profile
        // produces — the assembler caps a report at 24 blocks and the reviewer
        // emits an inline block only when it has real content — but it is the
        // only way to SEE the whole vocabulary without waiting for a pull request
        // that happens to trip all five inline blocks at once.
        //
        // Under "Full report" (every lens on) this is the ceiling of what a real
        // review may contain. What it actually contains is up to the diff.
        key: "everything",
        label: "Every block",
        note: "All 16 kinds at once — the ceiling of what the Full report preset unlocks. Real reviews show the subset the diff earns.",
        blocks: [
            { kind: "verdict_banner" },
            { kind: "callout", tone: "critical", title: "Unbound projects reach a destructive path", body: "Projects created before migration 0062 have no cell. `findCell` returns null and the delete proceeds against whatever the context is bound to." },
            {
                kind: "risk_matrix",
                title: "Risks",
                items: [
                    { label: "Purge runs against the home database", likelihood: "medium", impact: "high", detail: "An unbound project id reaches the regional delete with no cell resolved." },
                    { label: "Partial delete leaves orphaned rows", likelihood: "low", impact: "medium", detail: "The purge aborts mid-way if the first regional read throws." },
                ],
            },
            { kind: "score" },
            { kind: "tally" },
            { kind: "meters", dims: ["security", "correctness", "load_perf"] },
            { kind: "prose", role: "summary" },
            { kind: "prose", role: "impact" },
            { kind: "prose", role: "note", body: "The migration in this PR is reversible, but the code that reads the new column ships in the same change — deploy them together or the read fails closed." },
            { kind: "file_impact_list" },
            {
                kind: "spec_table",
                title: "Contract changes",
                columns: ["Symbol", "Before", "After", "Callers"],
                rows: [
                    ["ProjectDeletionService.delete", "(id: string)", "(id: string) throws", "2"],
                    ["ProjectsRepository.findCell", "string", "string | null", "5"],
                ],
            },
            {
                kind: "timeline",
                title: "History",
                items: [
                    { when: "6dacdc6", label: "fix(delete): bind the region before purging", detail: "the change under review" },
                    { when: "0062", label: "project region added", detail: "projects created before this have no cell" },
                ],
            },
            {
                kind: "dependency_list",
                items: [
                    { label: "pg", from: "8.11.3", to: "8.13.0", detail: "the driver the regional pool uses" },
                    { label: "zod", from: "3.22.4", to: "4.0.1", detail: "major bump — parse errors changed shape" },
                ],
            },
            { kind: "finding_group", state: "critical" },
            { kind: "finding_group", state: "review" },
            { kind: "finding_group", state: "good" },
            { kind: "claims_table" },
            { kind: "checklist" },
            { kind: "checks_footer" },
            { kind: "deep_dive_cta" },
        ],
    },
    {
        key: "empty",
        label: "Clean PR",
        note: "Nothing found. Blocks with no data return null, so this is a short panel rather than a column of empty boxes.",
        blocks: null,
    },
]

const CLEAN: PrAnalysis = {
    summary: "- Renames a private helper and updates its two call sites",
    impact: "- Self-contained: `formatCell` is only called by `renderRow`",
    verdict: "approve",
    verdict_reason: "looks safe to merge",
    score: 10,
    score_max: 10,
    confidences: {
        correctness: { level: "high", basis: "read both call sites" },
        load_perf: { level: "low", basis: "no perf-critical path" },
        security: { level: "low", basis: "no untrusted input" },
    },
    checks: { precedents: 1, callers: 2, tests: 0, git_reads: 0, failure_probes: 0 },
    duration_ms: 9_800,
}

// The three states of run attribution (0079). Switchable here because the whole
// point of the design is that they are DIFFERENT answers — "a profile ran", "the
// built-in reviewer ran", and "this run predates attribution, we don't know" —
// and a design that leans on the difference should be inspectable side by side.
const ATTRIBUTIONS: { key: string; label: string; note: string; value: ReviewRunProfile | null }[] = [
    {
        key: "profile",
        label: "Under a profile",
        note: "A team profile reviewed it. The chip names it and opens the policy that was actually sent.",
        value: {
            kind: "profile",
            id: "preview-profile",
            name: "Payments — strict",
            preset: "gatekeeper",
            policy: {
                strictness: "thorough",
                evidence: "strict",
                blocking: "any",
                positivity: "sparing",
                verbosity: "explanatory",
                voice: "neutral",
                depth: "deep",
                lenses: ["convention", "drift", "history", "security", "api_contract", "data_migration"],
                instructions: "We wrap errors with %w.",
                path_rules: [{ glob: "supabase/migrations/*", text: "Every migration must be reversible." }],
            },
        },
    },
    {
        key: "default",
        label: "Built-in default",
        note: "No profile assigned. Stated outright rather than left blank — silence is what made this unverifiable before.",
        value: { kind: "default" },
    },
    {
        key: "unknown",
        label: "Pre-0079 row",
        note: "A run from before attribution was recorded. No chip at all: guessing \"Default\" here would be the exact failure this feature exists to prevent.",
        value: null,
    },
]

export default function ReviewBlocksPreview() {
    const [key, setKey] = useState("classic")
    const [attrKey, setAttrKey] = useState("profile")
    const layout = LAYOUTS.find((l) => l.key === key)!
    const attribution = ATTRIBUTIONS.find((a) => a.key === attrKey)!
    const result = key === "empty" ? CLEAN : FIXTURE

    const analysis: PullRequestAnalysis = {
        id: "preview",
        project_id: "preview-project",
        pr_number: 1,
        status: "done",
        github_comment_id: null,
        head_sha: null,
        result: layout.blocks ? { ...result, report: { version: 1, blocks: layout.blocks } } : result,
        // Run attribution (0079). Real rows carry the snapshot the dispatch
        // actually sent; these are hand-written to match its shape.
        review_profile_id: attribution.value?.kind === "profile" ? attribution.value.id : null,
        review_profile: attribution.value,
        created_at: "",
        updated_at: "",
    }

    return (
        <div className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-8">
            <header>
                <h1 className="text-[18px] font-bold tracking-[-0.01em]">Review blocks</h1>
                <p className="mt-1 text-[13px] text-[color:var(--c-text-muted)]">
                    The PR review panel rendered from a fixture, through each layout a review profile
                    can produce. Same component the real page uses; no network.
                </p>
            </header>

            <div className="flex flex-wrap gap-1.5">
                {LAYOUTS.map((l) => (
                    <button
                        key={l.key}
                        type="button"
                        onClick={() => setKey(l.key)}
                        className={
                            "rounded-full border px-3 py-1.5 text-[12.5px] transition-colors " +
                            (key === l.key
                                ? "border-[color:var(--c-primary)] bg-[color:var(--c-primary-tint)] font-semibold"
                                : "border-[color:var(--c-border)] hover:border-[color:var(--c-border-strong)]")
                        }
                    >
                        {l.label}
                    </button>
                ))}
            </div>
            <p className="text-[12px] leading-5 text-[color:var(--c-text-muted)]">{layout.note}</p>

            <div className="flex flex-wrap gap-1.5">
                {ATTRIBUTIONS.map((a) => (
                    <button
                        key={a.key}
                        type="button"
                        onClick={() => setAttrKey(a.key)}
                        className={
                            "rounded-full border px-3 py-1.5 text-[12.5px] transition-colors " +
                            (attrKey === a.key
                                ? "border-[color:var(--c-primary)] bg-[color:var(--c-primary-tint)] font-semibold"
                                : "border-[color:var(--c-border)] hover:border-[color:var(--c-border-strong)]")
                        }
                    >
                        {a.label}
                    </button>
                ))}
            </div>
            <p className="text-[12px] leading-5 text-[color:var(--c-text-muted)]">{attribution.note}</p>
            <p className="font-mono text-[11px] text-[color:var(--c-text-dim)]">
                {(layout.blocks ?? CLASSIC_LAYOUT).map((b) => b.kind).join(" · ")}
            </p>

            <PrReview analysis={analysis} />
        </div>
    )
}
