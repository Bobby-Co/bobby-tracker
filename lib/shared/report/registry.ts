// The REPORT BLOCK REGISTRY — the vocabulary a PR review's layout is written in.
//
// A review used to be rendered twice from the same fixed field list: as React in
// components/pulls/report, and as GitHub-flavoured markdown in
// modules/analysis/infrastructure/PullRequestAnalysisComment. Both walked
// `PrAnalysis` top to bottom in the same order, which is fine while every review
// is the same kind of review, and stops being fine once a team can ask for a
// security-first or a ship-fast one.
//
// So the analyser now also sends a `report`: an ordered list of typed blocks
// drawn from the list below (analyser ADR-0066). This file is the single place
// the vocabulary is declared, and BOTH renderers map over it — report-renderers
// .test.ts fails the build if either map is missing a kind, which is what stops
// the app and the GitHub comment from drifting apart.
//
// Two properties to preserve when adding a kind:
//
//   • Blocks are SEMANTIC, never visual. `tone` is "critical", never "rose".
//     The renderers own their palettes; the analyser owns the meaning. This is
//     also why the markdown renderer can keep up at all — it has no CSS.
//
//   • REFERENCE blocks name canonical data ("the critical findings go here")
//     instead of carrying it. That is not tidiness: the analyser's deterministic
//     gate rewrites `findings` after the review pass, so a block holding its own
//     copy would show findings that were dropped and miss the ones the gate
//     synthesised. Only payloads nothing rewrites are INLINE.
//
// Pure and dependency-free (lib/shared), so the domain, the server renderer and
// the browser can all read it.

/** Every block kind the analyser may send. A kind absent here does not render —
 *  the renderers skip it — so an older tracker meeting a newer analyser degrades
 *  to the blocks it understands instead of breaking. */
export const BLOCK_KINDS = [
    // ── reference: payload-free, they render canonical PrAnalysis data ──
    "verdict_banner",
    "score",
    "tally",
    "meters",
    "prose",
    "finding_group",
    "file_impact_list",
    "claims_table",
    "checklist",
    "checks_footer",
    "deep_dive_cta",
    // ── inline: they carry their own payload ──
    "callout",
    "spec_table",
    "timeline",
    "dependency_list",
    "risk_matrix",
] as const

export type BlockKind = (typeof BLOCK_KINDS)[number]

/** The traffic-light state a `finding_group` selects on. Matches findingState —
 *  the classification the merge gate also reads — not raw severity. */
export type BlockState = "critical" | "review" | "good"

/** Which prose a `prose` block shows. "note" carries its own body; the other two
 *  reference the analysis. */
export type BlockRole = "summary" | "impact" | "note"

/** Semantic colour vocabulary. Deliberately not colour names: each renderer maps
 *  these to its own palette (the app to `--c-*` tokens, the comment to badge
 *  tones), so neither has to know about the other's. */
export type BlockTone = "neutral" | "info" | "good" | "warn" | "critical"

/** One row of an inline list block. Which fields carry meaning depends on the
 *  parent kind; all are optional so one type serves three blocks. */
export interface BlockItem {
    /** timeline: the commit date or rev. */
    when?: string
    /** The headline — a commit subject, a package name, a risk. */
    label?: string
    /** dependency_list: the version delta. */
    from?: string
    to?: string
    /** risk_matrix: "low" | "medium" | "high" on each axis. */
    likelihood?: string
    impact?: string
    /** A sentence of context, and an optional location the reader can open. */
    detail?: string
    file?: string
    line?: number
}

/** One entry in a report. A flat shape with optional members rather than a
 *  per-kind union: it arrives as JSON that may come from a newer analyser, and a
 *  renderer that meets a field it doesn't know should ignore it rather than
 *  fail to parse. Renderers switch on `kind` and read only what they need. */
export interface ReportBlock {
    kind: BlockKind
    state?: BlockState
    role?: BlockRole
    /** Orders (and subsets) the confidence meters. Empty means all three. */
    dims?: string[]
    title?: string
    tone?: BlockTone
    body?: string
    columns?: string[]
    rows?: string[][]
    items?: BlockItem[]
}

/** The layout accompanying a stored review. Absent on every row written before
 *  blocks existed — and that absence is meaningful: it means "render the classic
 *  layout", which is why neither renderer treats it as an error. */
export interface Report {
    version: number
    blocks: ReportBlock[]
}

const KNOWN = new Set<string>(BLOCK_KINDS)

/** Whether this tracker knows how to render this kind. */
export function isBlockKind(k: string): k is BlockKind {
    return KNOWN.has(k)
}

/** The blocks of a report, filtered to the ones this tracker can render.
 *
 *  Returns null when there is no usable report, which is the signal to fall back
 *  to the classic layout. Null rather than an empty array on purpose: "the
 *  analyser sent no layout" and "the analyser sent a layout of nothing" want
 *  different handling, and only the first should resurrect the old order. */
export function usableBlocks(report: Report | null | undefined): ReportBlock[] | null {
    if (!report || !Array.isArray(report.blocks)) return null
    const blocks = report.blocks.filter((b) => b && typeof b.kind === "string" && isBlockKind(b.kind))
    return blocks.length > 0 ? blocks : null
}

/** The classic layout — the review panel exactly as it rendered before blocks,
 *  expressed in the same vocabulary.
 *
 *  Kept here rather than in either renderer because BOTH need it for legacy
 *  rows, and a second copy would be a second thing to keep in step. It mirrors
 *  classicLayout() in the analyser's internal/pranalysis/blocks.go; the two are
 *  allowed to drift only in the sense that this one is what old rows get. */
export const CLASSIC_LAYOUT: ReportBlock[] = [
    { kind: "verdict_banner" },
    { kind: "score" },
    { kind: "tally" },
    { kind: "meters" },
    { kind: "prose", role: "summary" },
    { kind: "prose", role: "impact" },
    { kind: "file_impact_list" },
    { kind: "finding_group", state: "critical" },
    { kind: "finding_group", state: "review" },
    { kind: "finding_group", state: "good" },
    { kind: "claims_table" },
    { kind: "checklist" },
    { kind: "checks_footer" },
    { kind: "deep_dive_cta" },
]

/** The layout to render for a review: what the analyser asked for, else classic. */
export function layoutFor(report: Report | null | undefined): ReportBlock[] {
    return usableBlocks(report) ?? CLASSIC_LAYOUT
}
