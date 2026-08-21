"use client"

import { Fragment, useState } from "react"
import { useRouter } from "next/navigation"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import rehypeHighlight from "rehype-highlight"
import { cn } from "@/components/ui/cn"
import { severityLabel } from "@/lib/shared/rendering/badge"
import { findingState } from "@/lib/shared/rendering/finding-state"
import { apiMutate } from "@/lib/client/http/api-client"
import { layoutFor, type BlockKind, type BlockState, type BlockTone, type ReportBlock } from "@/lib/shared/report/registry"
import type { PrAnalysis, PrChecks, PrConfidenceDimension, PrConfidences, PrFinding, PullRequestAnalysis, ReviewRunProfile } from "@/lib/shared/types"
import type { DeltaFinding, RoundDelta } from "@/modules/analysis/domain/ReviewRounds"
// Domain file directly, never the barrel — the barrel reaches infrastructure and
// next/headers, which fails the browser build. See review-profile-panel.
import { DEFAULT_LENSES, DIAL_SPECS, LENSES, lensActivity } from "@/modules/analysis/domain/ReviewProfile"

// Md renders markdown with GFM + syntax highlighting (rehype-highlight → the
// `.prose-tracker .hljs-*` theme in globals.css). Used for summary/impact/detail
// and the per-finding diff snippets.
function Md({ children, className }: { children: string; className?: string }) {
    return (
        <div className={cn("prose-tracker", className)}>
            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[[rehypeHighlight, { ignoreMissing: true, detect: true }]]}>
                {children}
            </ReactMarkdown>
        </div>
    )
}

// Renders Ucelot's persisted PR review (pull_request_analyses.result) natively —
// the same structured shape the analyser posts to the GitHub comment, minus the
// markdown scraping. Falls back to a status-appropriate placeholder when there's
// no result to show.

function verdictClasses(v: string): string {
    switch (v) {
        case "likely":
            return "bg-emerald-50 text-emerald-700"
        case "partial":
            return "bg-amber-50 text-amber-700"
        case "unlikely":
            return "bg-rose-50 text-rose-700"
        default:
            return "bg-[color:var(--c-surface-2)] text-[color:var(--c-text-muted)]"
    }
}

function confidenceClasses(c: string): string {
    switch (c) {
        case "high":
            return "bg-emerald-50 text-emerald-700"
        case "medium":
            return "bg-amber-50 text-amber-700"
        default:
            return "bg-rose-50 text-rose-700"
    }
}

// A short human label for a finding category (ADR-0057).
function categoryLabel(c: string): string {
    switch (c) {
        case "blast_radius":
            return "blast radius"
        case "test_gap":
            return "test gap"
        case "bug":
        case "good":
            return "" // redundant with the severity chip
        default:
            return c.replace(/_/g, " ")
    }
}

// Traffic-light chip by state: critical=rose, review=amber, good=emerald.
function severityClasses(s: string): string {
    const st = findingState(s)
    return st === "critical" ? "bg-rose-50 text-rose-700" : st === "good" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
}

function verdictBannerClasses(v: string): string {
    switch (v) {
        case "approve":
            return "border-emerald-200 bg-emerald-50 text-emerald-800"
        case "request_changes":
            return "border-rose-200 bg-rose-50 text-rose-800"
        default:
            return "border-amber-200 bg-amber-50 text-amber-800"
    }
}

function verdictLabel(v: string): string {
    return v === "approve" ? "Approve" : v === "request_changes" ? "Changes requested" : "Comment"
}

function VerdictIcon({ v }: { v: string }) {
    if (v === "approve") {
        return (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M20 6L9 17l-5-5" />
            </svg>
        )
    }
    if (v === "request_changes") {
        return (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <circle cx="12" cy="12" r="9" />
                <path d="M15 9l-6 6M9 9l6 6" />
            </svg>
        )
    }
    return (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
    )
}

function Shell({ children, profile }: { children: React.ReactNode; profile?: ReviewRunProfile | null }) {
    return (
        <section className="rounded-[16px] border border-[color:var(--c-border)] bg-[color:var(--c-surface)] p-4 shadow-[var(--shadow-card)] sm:p-5">
            <div className="mb-3 flex items-center gap-2">
                <span className="grid h-6 w-6 place-items-center rounded-[7px] bg-amber-50 text-amber-600">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <circle cx="11" cy="11" r="7" />
                        <path d="M21 21l-4.3-4.3" />
                    </svg>
                </span>
                <h2 className="text-[14px] font-bold tracking-[-0.005em]">Ucelot · PR review</h2>
                {/* In the HEADER, not the footer, and rendered for every status
                    including "analysing": the attribution is written when the run
                    is dispatched, so the answer to "which reviewer is this?" is
                    available from the moment the spinner appears — which is
                    exactly when somebody who just changed the setting is looking. */}
                <ProfileTag profile={profile ?? null} />
            </div>
            {children}
        </section>
    )
}

// Which reviewer produced this review (0079), and — on click — the settings it
// actually ran with.
//
// The dials are shown from the run's own SNAPSHOT rather than fetched from the
// profile, and that is the entire point of the control. A profile that has been
// edited since, reassigned since, or deleted since would otherwise describe this
// review as something it never was; what is rendered here is the policy that
// crossed the wire, so "did my setting take effect?" is answerable from the
// review itself instead of by trusting that the plumbing worked.
function ProfileTag({ profile }: { profile: ReviewRunProfile | null }) {
    const [open, setOpen] = useState(false)

    // A run from before attribution existed. Claiming "Default" here would be a
    // guess dressed as a fact — the one thing this control exists to avoid.
    if (!profile) return null

    const isDefault = profile.kind === "default"
    return (
        <div className="relative ml-auto">
            <button
                type="button"
                onClick={() => !isDefault && setOpen((o) => !o)}
                aria-expanded={isDefault ? undefined : open}
                title={isDefault ? "This review ran under the built-in reviewer" : "What this profile was set to for this review"}
                className={cn(
                    "inline-flex max-w-[220px] items-center gap-1 rounded-full border border-[color:var(--c-border)] px-2 py-[3px] text-[11px] text-[color:var(--c-text-muted)]",
                    isDefault ? "cursor-default" : "cursor-pointer hover:border-[color:var(--c-border-strong)]",
                )}
            >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3" />
                    <path d="M1 14h6M9 8h6M17 16h6" />
                </svg>
                <span className="truncate">{isDefault ? "Default reviewer" : profile.name}</span>
                {!isDefault && <span aria-hidden className="text-[color:var(--c-text-dim)]">{open ? "▴" : "▾"}</span>}
            </button>

            {open && profile.kind === "profile" && <PolicyCard profile={profile} onClose={() => setOpen(false)} />}
        </div>
    )
}

function PolicyCard({ profile, onClose }: { profile: Extract<ReviewRunProfile, { kind: "profile" }>; onClose: () => void }) {
    const p = profile.policy
    // Labels come from the same catalogue the settings form is built from, so the
    // two surfaces can never disagree about what "strict" is called. A value this
    // build doesn't know is shown verbatim rather than dropped — an unfamiliar
    // dial is still evidence of what ran.
    const dials = DIAL_SPECS.map((spec) => {
        const value = String((p as unknown as Record<string, unknown>)[spec.key] ?? "")
        return { key: spec.key, label: spec.label, value: spec.options.find((o) => o.value === value)?.label ?? value }
    }).filter((d) => d.value)

    const lensLabels = (p.lenses ?? []).map((k) => LENSES.find((l) => l.key === k)?.label ?? k.replace(/_/g, " "))

    return (
        <div className="absolute right-0 top-[calc(100%+6px)] z-20 w-[280px] rounded-[12px] border border-[color:var(--c-border)] bg-[color:var(--c-surface)] p-3 text-left shadow-[var(--shadow-card)]">
            <div className="flex items-start gap-2">
                <div className="min-w-0">
                    <p className="truncate text-[12.5px] font-semibold">{profile.name}</p>
                    <p className="mt-0.5 text-[11px] text-[color:var(--c-text-dim)]">Settings used for this review</p>
                </div>
                <button type="button" onClick={onClose} aria-label="Close" className="ml-auto text-[color:var(--c-text-dim)] hover:text-[color:var(--c-text)]">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
                        <path d="M18 6L6 18M6 6l12 12" />
                    </svg>
                </button>
            </div>

            <dl className="mt-2.5 flex flex-col gap-1">
                {dials.map((d) => (
                    <div key={d.key} className="flex items-baseline justify-between gap-3">
                        <dt className="text-[11px] text-[color:var(--c-text-muted)]">{d.label}</dt>
                        <dd className="truncate text-[11px] font-medium">{d.value}</dd>
                    </div>
                ))}
            </dl>

            <div className="mt-2.5 border-t border-[color:var(--c-border)] pt-2 text-[11px] text-[color:var(--c-text-muted)]">
                {/* An empty lens list is meaningful — every optional lens off —
                    so it gets a sentence rather than a blank row. */}
                <p>{lensLabels.length ? `Lenses: ${lensLabels.join(", ")}.` : "No optional lenses."}</p>
                {p.instructions ? <p className="mt-1">Team instructions applied.</p> : null}
                {p.path_rules?.length ? <p className="mt-1">{p.path_rules.length} path rule{p.path_rules.length === 1 ? "" : "s"} applied.</p> : null}
            </div>
        </div>
    )
}

/** One round per push, oldest first — the panel's memory.
 *
 *  It exists because a re-review used to replace the last one, so a developer
 *  who had just fixed three of five blockers saw a fresh verdict with no sign
 *  that anything had moved. The strip is the difference between a verdict and a
 *  conversation. */
function RoundStrip({ rounds }: { rounds: RoundSummary[] }) {
    if (rounds.length < 2) return null // one round is not a story
    return (
        <div className="flex gap-0 overflow-x-auto rounded-[10px] border border-[color:var(--c-border)]">
            {rounds.map((r, i) => {
                const last = i === rounds.length - 1
                return (
                    <div
                        key={r.headSha + r.round}
                        className={cn(
                            "flex min-w-[9.5rem] flex-1 flex-col gap-1 border-r border-[color:var(--c-border)] px-3 py-2 last:border-r-0",
                            last && "bg-[color:var(--c-primary-tint)]",
                        )}
                    >
                        <span className={cn("font-mono text-[10.5px]", last ? "font-semibold text-[color:var(--c-primary)]" : "text-[color:var(--c-text-muted)]")}>
                            {r.headSha.slice(0, 7)} · round {r.round}
                        </span>
                        <span className="text-[12px] font-semibold leading-4">{r.verdict ? verdictLabel(r.verdict) : "—"}</span>
                        <span className="flex flex-wrap gap-1">
                            {r.degraded && <DeltaChip kind="partial" />}
                            {r.fixed > 0 && <DeltaChip kind="fixed" n={r.fixed} />}
                            {r.blockers > 0 && <DeltaChip kind="blockers" n={r.blockers} />}
                            {!r.degraded && r.blockers === 0 && <DeltaChip kind="clear" />}
                        </span>
                    </div>
                )
            })}
        </div>
    )
}

export interface RoundSummary {
    headSha: string
    round: number
    verdict: string | null
    blockers: number
    fixed: number
    degraded: boolean
}

/** `plural` is set only where the label is a NOUN. "blocker" pluralises; "new"
 *  and "fixed" describe the findings and do not — appending an s to them
 *  produced "2 news", which is how you can tell a label table was written as if
 *  every word behaved the same way. */
const DELTA_STYLE: Record<string, { label: string; plural?: string; cls: string }> = {
    // Semantic, not decorative: these encode what happened to a finding between
    // pushes, which is the one thing a returning developer wants to know first.
    new:       { label: "new",        cls: "bg-[color:var(--c-info-bg)] text-[color:var(--c-info-fg)]" },
    still_open:{ label: "still open", cls: "bg-[color:var(--c-rose-bg)] text-[color:var(--c-rose-fg)]" },
    regressed: { label: "back again", cls: "bg-[color:var(--c-warn-bg)] text-[color:var(--c-warn)]" },
    fixed:     { label: "fixed",      cls: "bg-[color:var(--c-output-bg)] text-[color:var(--c-output-fg)]" },
    blockers:  { label: "blocker",    plural: "blockers", cls: "bg-[color:var(--c-rose-bg)] text-[color:var(--c-rose-fg)]" },
    clear:     { label: "clear",      cls: "bg-[color:var(--c-output-bg)] text-[color:var(--c-output-fg)]" },
    partial:   { label: "partial",    cls: "bg-[color:var(--c-warn-bg)] text-[color:var(--c-warn)]" },
}

function DeltaChip({ kind, n }: { kind: string; n?: number }) {
    const style = DELTA_STYLE[kind]
    if (!style) return null
    const word = n != null && n !== 1 && style.plural ? style.plural : style.label
    return (
        <span className={cn("inline-flex shrink-0 items-center rounded-full px-1.5 py-[1px] text-[10px] font-semibold", style.cls)}>
            {n != null ? `${n} ${word}` : word}
        </span>
    )
}

/** "3 of 5 blockers resolved, 2 remain" — the one sentence a developer who has
 *  been fixing things wants before anything else. */
function ProgressLine({ delta }: { delta: RoundDelta | null }) {
    if (!delta) return null
    if (delta.withheld) {
        return (
            <p className="rounded-[8px] border border-[color:var(--c-warn)]/30 bg-[color:var(--c-warn-bg)] px-3 py-1.5 text-[12px] text-[color:var(--c-warn)]">
                This round didn&rsquo;t complete, so nothing is counted as resolved — the blockers below may be stale.
            </p>
        )
    }
    if (delta.counts.fixed === 0) return null
    return (
        <p className="flex flex-wrap items-center gap-1.5 text-[12px] text-[color:var(--c-text-muted)]">
            <DeltaChip kind="fixed" n={delta.counts.fixed} />
            <span>since the last push</span>
            {delta.counts.regressed > 0 && <DeltaChip kind="regressed" n={delta.counts.regressed} />}
            {delta.counts.new > 0 && <DeltaChip kind="new" n={delta.counts.new} />}
        </p>
    )
}

/** The delta state for one finding, matched the same way diffRounds tagged it.
 *  Compares the finding OBJECT, which is the same reference the delta was built
 *  from — no second fingerprinting here, so the panel cannot disagree with the
 *  arithmetic that produced the counts. */
function deltaOf(delta: RoundDelta | null | undefined, f: PrFinding): DeltaFinding["delta"] | null {
    if (!delta) return null
    return delta.current.find((d) => d.finding === f)?.delta ?? null
}

function Placeholder({ tone, text }: { tone: "muted" | "amber" | "rose"; text: string }) {
    const cls =
        tone === "amber"
            ? "border-amber-200 bg-amber-50 text-amber-900"
            : tone === "rose"
              ? "border-rose-200 bg-rose-50 text-rose-800"
              : "border-dashed border-[color:var(--c-border)] bg-[color:var(--c-surface)] text-[color:var(--c-text-muted)]"
    return <div className={cn("rounded-[12px] border px-4 py-6 text-center text-[13px]", cls)}>{text}</div>
}

export function PrReview({ analysis, rounds = [], delta = null }: {
    analysis: PullRequestAnalysis | null
    /** Oldest first. Fewer than two and the strip stays hidden — one round is
     *  not a story, and an empty strip is worse than none. */
    rounds?: RoundSummary[]
    /** How this review compares with the round before it, or null on a first
     *  review. Drives the per-finding chips and the progress line. */
    delta?: RoundDelta | null
}) {
    const status = analysis?.status ?? null
    const result = analysis?.result ?? null
    const profile = analysis?.review_profile ?? null

    if (status === "analysing") {
        return (
            <Shell profile={profile}>
                <Placeholder tone="amber" text="Ucelot is reviewing this pull request… this panel fills in automatically." />
            </Shell>
        )
    }
    if (status === "failed") {
        return (
            <Shell profile={profile}>
                <Placeholder tone="rose" text="Ucelot couldn't complete the review this time." />
            </Shell>
        )
    }
    if (status === "cancelled") {
        return (
            <Shell profile={profile}>
                <Placeholder tone="muted" text="The review was cancelled (the PR was closed before it finished)." />
            </Shell>
        )
    }
    if (!result) {
        return (
            <Shell>
                <Placeholder tone="muted" text="No review yet for this pull request." />
            </Shell>
        )
    }

    return (
        <Shell profile={profile}>
            <RoundStrip rounds={rounds} />
            <ProgressLine delta={delta} />
            <Review r={result} projectId={analysis?.project_id ?? null} profile={profile} delta={delta} />
        </Shell>
    )
}

// Finding group titles + tones by traffic-light state. The analyser sends the
// state; how a state LOOKS is ours, which is the whole reason nothing on the
// wire is a colour.
const GROUP_STYLE: Record<BlockState, { title: string; tone: string; open: boolean }> = {
    critical: { title: "Blockers", tone: "bg-rose-100 text-rose-700", open: true },
    review: { title: "Worth a review", tone: "bg-amber-100 text-amber-700", open: true },
    good: { title: "Looks good", tone: "bg-emerald-100 text-emerald-700", open: false },
}

// Semantic tone → the app's token pairs. The markdown renderer maps the same
// five words to badge tones; neither knows about the other's palette.
//
// Built from --c-* pairs rather than `rose-50`/`amber-50` literals, and that is
// not a style preference. A callout's BODY goes through Md, which wraps it in
// .prose-tracker and colours it with --c-text — a theme-aware value. Pair that
// with a fixed light background and dark mode renders near-white text on a
// near-white card. This is the same trap 5379f1d cleaned up across the app: a
// literal that only works in one theme, sitting next to a token that works in
// both.
const TONE_CLASSES: Record<BlockTone, string> = {
    neutral: "border-[color:var(--c-border)] bg-[color:var(--c-surface-2)] text-[color:var(--c-text)]",
    info: "border-[color:var(--c-info-fg)]/25 bg-[color:var(--c-info-bg)] text-[color:var(--c-info-fg)]",
    // --c-output-* rather than --c-success-*: the success token is a FILL green
    // (#16a34a) and only reaches 3.2:1 as text on its own pale tint, under the
    // 4.5:1 floor. The output pair is the app's green TEXT pair and clears 7:1
    // in both themes.
    good: "border-[color:var(--c-output-fg)]/30 bg-[color:var(--c-output-bg)] text-[color:var(--c-output-fg)]",
    warn: "border-[color:var(--c-warn)]/30 bg-[color:var(--c-warn-bg)] text-[color:var(--c-warn)]",
    critical: "border-[color:var(--c-rose-fg)]/30 bg-[color:var(--c-rose-bg)] text-[color:var(--c-rose-fg)]",
}

// Risk severity → text colour, for the likelihood/impact axes. Tokens for the
// same reason as above: these sit on the page surface, which inverts.
const RISK_CLASSES: Record<string, string> = {
    high: "text-[color:var(--c-rose-fg)]", // 8.0 light / 9.1 dark
    medium: "text-[color:var(--c-warn)]", // 5.0 / 10.7
    low: "text-[color:var(--c-output-fg)]", // 7.7 / 11.7 — see the note above
}

/** What every block renderer gets. `r` is the canonical review — reference
 *  blocks read it, which is what keeps them in step with the analyser's gate
 *  rewriting `findings` after the fact. `b` is the block's own payload. */
interface BlockProps {
    b: ReportBlock
    r: PrAnalysis
    projectId: string | null
    /** Round-over-round state, so a finding can say whether it is new or one you
     *  have already seen. Null on a first review. */
    delta?: RoundDelta | null
    /** The run's attribution snapshot, for blocks that report on the review
     *  itself rather than on the code. Null for a row written before 0079. */
    profile: ReviewRunProfile | null
}

// The renderer table. Typed as a Record over BlockKind ON PURPOSE: adding a kind
// to the registry without adding a renderer here is then a TYPE error, not a
// blank space someone notices in production. The GitHub-comment renderer is
// keyed the same way, so the two surfaces cannot drift apart silently.
const BLOCKS: Record<BlockKind, (p: BlockProps) => React.ReactNode> = {
    verdict_banner: ({ r }) =>
        !r.verdict ? null : (
            <div className={cn("flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[10px] border px-3 py-2", verdictBannerClasses(r.verdict))}>
                <span className="inline-flex items-center gap-1.5 text-[13px] font-bold">
                    <VerdictIcon v={r.verdict} />
                    {verdictLabel(r.verdict)}
                </span>
                {r.verdict_reason && <span className="text-[12.5px] leading-5 opacity-90">— {r.verdict_reason}</span>}
            </div>
        ),

    // Merge-readiness headline: the analyser's score + bar, or a plain "not
    // ready" placeholder when it didn't send one (never faked).
    score: ({ r }) =>
        typeof r.score === "number" && r.score_max ? (
            <ScoreBar value={r.score} max={r.score_max} />
        ) : (
            <div className="flex items-center gap-2 rounded-[12px] border border-dashed border-[color:var(--c-border)] bg-[color:var(--c-surface)] px-3.5 py-2.5">
                <span className="text-[12.5px] font-semibold text-[color:var(--c-text)]">Merge readiness</span>
                <span className="text-[12px] text-[color:var(--c-text-muted)]">· not ready</span>
            </div>
        ),

    // Finding tally, so the reader orients before scrolling.
    tally: ({ r }) => {
        const f = r.findings ?? []
        const n = (s: BlockState) => f.filter((x) => findingState(x.severity) === s).length
        const [crit, rev, good] = [n("critical"), n("review"), n("good")]
        if (crit + rev + good === 0) return null
        return (
            <div className="flex flex-wrap items-center gap-1.5">
                {crit > 0 && <Tally n={crit} label="blocker" tone="bg-rose-100 text-rose-700" />}
                {rev > 0 && <Tally n={rev} label="to review" tone="bg-amber-100 text-amber-700" />}
                {good > 0 && <Tally n={good} label="good" tone="bg-emerald-100 text-emerald-700" />}
            </div>
        )
    },

    // Per-dimension confidence as 3-stage meters, coloured by level. `dims`
    // lets a profile lead with the dimension it cares about — a security-first
    // review shows security first — and falls back to the canonical order.
    meters: ({ b, r }) =>
        r.confidences ? (
            <ConfidenceMeters c={r.confidences} dims={b.dims} />
        ) : r.confidence ? (
            <span className={cn("inline-flex w-fit items-center rounded-full px-2 py-[2px] text-[11px] font-semibold", confidenceClasses(r.confidence))}>
                confidence: {r.confidence}
            </span>
        ) : null,

    prose: ({ b, r }) => {
        if (b.role === "summary") {
            return !r.summary?.trim() ? null : (
                <blockquote className="border-l-2 border-amber-300 pl-3 text-[13.5px] leading-6 text-[color:var(--c-text)]">
                    <Md>{r.summary}</Md>
                </blockquote>
            )
        }
        if (b.role === "impact") {
            return !r.impact?.trim() ? null : (
                <Section title={b.title || "Impact"}>
                    <Md className="text-[13px] leading-6">{r.impact}</Md>
                </Section>
            )
        }
        // "note" — the one prose role that carries its own text, for a lens that
        // wants to say something no canonical field holds.
        return !b.body?.trim() ? null : (
            <Section title={b.title || "Note"}>
                <Md className="text-[13px] leading-6">{b.body}</Md>
            </Section>
        )
    },

    finding_group: ({ b, r, delta }) => {
        const state = b.state ?? "review"
        const items = (r.findings ?? []).filter((f) => findingState(f.severity) === state)
        if (items.length === 0) return null
        const style = GROUP_STYLE[state] ?? GROUP_STYLE.review
        return (
            <Section title={b.title || style.title} count={items.length} countTone={style.tone} defaultOpen={style.open}>
                <div className="flex flex-col gap-2">
                    {items.map((f, i) => (
                        <Finding key={i} f={f} delta={deltaOf(delta, f)} />
                    ))}
                </div>
            </Section>
        )
    },

    file_impact_list: ({ b, r }) => {
        const files = r.impact_files ?? []
        if (files.length === 0) return null
        return (
            <Section title={b.title || "Affected files"} count={files.length}>
                <ul className="flex flex-col gap-1.5">
                    {files.map((f, i) => (
                        <li key={i} className="text-[12.5px] leading-5">
                            <code className="rounded bg-[color:var(--c-surface-2)] px-1 py-[1px] font-mono text-[11.5px]">{f.file}</code>
                            <span className="text-[color:var(--c-text-muted)]"> — {f.reason}</span>
                        </li>
                    ))}
                </ul>
            </Section>
        )
    },

    claims_table: ({ b, r }) => {
        const claims = r.fix_claims ?? []
        if (claims.length === 0) return null
        return (
            <Section title={b.title || "Fix claims"} count={claims.length}>
                <div className="flex flex-col gap-2">
                    {claims.map((c, i) => (
                        <div key={i} className="rounded-[10px] border border-[color:var(--c-border)] bg-[color:var(--c-surface-2)] p-2.5">
                            <div className="flex items-start justify-between gap-2">
                                <span className="min-w-0 flex-1 text-[12.5px] font-medium">{c.claim}</span>
                                <span className={cn("shrink-0 rounded-full px-2 py-[1px] text-[10.5px] font-semibold", verdictClasses(c.verdict))}>
                                    {c.verdict || "unclear"}
                                </span>
                            </div>
                            {c.reason && <p className="mt-1 text-[12px] leading-5 text-[color:var(--c-text-muted)]">{c.reason}</p>}
                        </div>
                    ))}
                </div>
            </Section>
        )
    },

    checklist: ({ b, r }) => {
        const items = r.checklist ?? []
        if (items.length === 0) return null
        return (
            <Section title={b.title || "Nice to check"} count={items.length} defaultOpen={false}>
                <ul className="flex flex-col gap-1.5">
                    {items.map((c, i) => (
                        <li key={i} className="flex items-start gap-2 text-[12.5px] leading-5 text-[color:var(--c-text-muted)]">
                            <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-[color:var(--c-text-dim)]" aria-hidden />
                            <span>{c}</span>
                        </li>
                    ))}
                </ul>
            </Section>
        )
    },

    checks_footer: ({ r, profile }) => (
        <ChecksFooter checks={r.checks ?? null} findings={r.findings ?? []} profile={profile} build={r.analyser_build} />
    ),

    deep_dive_cta: ({ r, projectId }) =>
        r.duration_ms == null && !(r.insight_id && projectId) ? null : (
            <div className="flex items-center justify-between gap-3 pt-1">
                {r.insight_id && projectId ? <DeepDiveButton insightId={r.insight_id} projectId={projectId} /> : <span />}
                {r.duration_ms != null && (
                    <p className="text-[11px] text-[color:var(--c-text-dim)]">Reviewed in {(r.duration_ms / 1000).toFixed(1)}s</p>
                )}
            </div>
        ),

    // ── inline blocks: these carry their own payload, because no canonical
    //    field holds it and the analyser's gate has no opinion about it ──

    callout: ({ b }) =>
        !b.body?.trim() && !b.title?.trim() ? null : (
            <div className={cn("rounded-[10px] border px-3 py-2.5", TONE_CLASSES[b.tone ?? "neutral"])}>
                {b.title && <p className="text-[12.5px] font-bold leading-5">{b.title}</p>}
                {b.body && <div className="mt-0.5 text-[12.5px] leading-5 text-[color:var(--c-text)] opacity-90"><Md>{b.body}</Md></div>}
            </div>
        ),

    spec_table: ({ b }) => {
        const rows = b.rows ?? []
        if (rows.length === 0) return null
        const cols = b.columns ?? []
        return (
            <Section title={b.title || "Details"} count={rows.length}>
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-[12px]">
                        {cols.length > 0 && (
                            <thead>
                                <tr>
                                    {cols.map((c, i) => (
                                        <th key={i} className="whitespace-nowrap border-b border-[color:var(--c-border)] pb-1.5 pr-3 text-[10.5px] font-semibold uppercase tracking-wide text-[color:var(--c-text-muted)]">
                                            {c}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                        )}
                        <tbody>
                            {rows.map((row, i) => (
                                <tr key={i}>
                                    {row.map((cell, j) => (
                                        <td key={j} className="border-b border-[color:var(--c-border)] py-1.5 pr-3 align-top leading-5 text-[color:var(--c-text-muted)]">
                                            {cell}
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </Section>
        )
    },

    timeline: ({ b }) => {
        const items = b.items ?? []
        if (items.length === 0) return null
        return (
            <Section title={b.title || "History"} count={items.length} defaultOpen={false}>
                <ul className="flex flex-col gap-2">
                    {items.map((it, i) => (
                        <li key={i} className="flex items-baseline gap-2 text-[12.5px] leading-5">
                            {it.when && <code className="shrink-0 font-mono text-[10.5px] text-[color:var(--c-text-dim)]">{it.when}</code>}
                            <span className="min-w-0">
                                <span className="font-medium">{it.label}</span>
                                {it.detail && <span className="text-[color:var(--c-text-muted)]"> — {it.detail}</span>}
                            </span>
                        </li>
                    ))}
                </ul>
            </Section>
        )
    },

    dependency_list: ({ b }) => {
        const items = b.items ?? []
        if (items.length === 0) return null
        return (
            <Section title={b.title || "Dependencies"} count={items.length}>
                <ul className="flex flex-col gap-1.5">
                    {items.map((it, i) => (
                        <li key={i} className="flex flex-wrap items-baseline gap-x-2 text-[12.5px] leading-5">
                            <code className="rounded bg-[color:var(--c-surface-2)] px-1 py-[1px] font-mono text-[11.5px]">{it.label}</code>
                            {(it.from || it.to) && (
                                <span className="font-mono text-[11px] text-[color:var(--c-text-dim)]">
                                    {it.from || "—"} → {it.to || "—"}
                                </span>
                            )}
                            {it.detail && <span className="text-[color:var(--c-text-muted)]">{it.detail}</span>}
                        </li>
                    ))}
                </ul>
            </Section>
        )
    },

    risk_matrix: ({ b }) => {
        const items = b.items ?? []
        if (items.length === 0) return null
        const axis = (v?: string) => RISK_CLASSES[v ?? ""] ?? "text-[color:var(--c-text-muted)]"
        return (
            <Section title={b.title || "Risks"} count={items.length}>
                <ul className="flex flex-col gap-2">
                    {items.map((it, i) => (
                        <li key={i} className="flex flex-wrap items-baseline gap-x-2 text-[12.5px] leading-5">
                            <span className="min-w-0 flex-1 font-medium">{it.label}</span>
                            <span className="shrink-0 text-[11px]">
                                <span className={axis(it.likelihood)}>{it.likelihood || "—"}</span>
                                <span className="text-[color:var(--c-text-dim)]"> likelihood · </span>
                                <span className={axis(it.impact)}>{it.impact || "—"}</span>
                                <span className="text-[color:var(--c-text-dim)]"> impact</span>
                            </span>
                            {it.detail && <p className="w-full text-[12px] text-[color:var(--c-text-muted)]">{it.detail}</p>}
                        </li>
                    ))}
                </ul>
            </Section>
        )
    },
}

// Renders the review by walking the layout the analyser sent — or the classic
// one, for the years of stored reviews written before layouts existed. Blocks
// whose data is empty return null and simply take up no space, so a small PR
// doesn't render as a column of empty boxes.
function Review({ r, projectId, profile, delta }: { r: PrAnalysis; projectId: string | null; profile: ReviewRunProfile | null; delta?: RoundDelta | null }) {
    return (
        <div className="flex flex-col gap-3">
            {layoutFor(r.report).map((b, i) => {
                const render = BLOCKS[b.kind]
                // Belt to the registry filter's braces: layoutFor already drops
                // kinds we don't know, but this render path is the one place a
                // newer analyser's vocabulary reaches the browser.
                if (!render) return null
                return <Fragment key={i}>{render({ b, r, projectId, profile, delta: delta ?? null })}</Fragment>
            })}

            {/* AI disclaimer — subtle, like the platforms' "can make mistakes" note.
                Outside the layout on purpose: it is not the analyser's to omit. */}
            <p className="pt-1 text-[10.5px] leading-4 text-[color:var(--c-text-dim)]">
                Ucelot is AI-assisted and can make mistakes — verify findings before acting.
            </p>
        </div>
    )
}

// Tally is one at-a-glance count pill ("2 blockers").
function Tally({ n, label, tone }: { n: number; label: string; tone: string }) {
    return (
        <span className={cn("inline-flex items-center rounded-full px-2 py-[2px] text-[11px] font-semibold", tone)}>
            {n} {label}
            {n === 1 || label.endsWith("review") || label === "good" ? "" : "s"}
        </span>
    )
}

// Section is a native collapsible <details> block with a header + optional count,
// so a long review collapses into a scannable outline.
function Section({
    title,
    count,
    countTone,
    defaultOpen = true,
    children,
}: {
    title: string
    count?: number
    countTone?: string
    defaultOpen?: boolean
    children: React.ReactNode
}) {
    return (
        <details open={defaultOpen} className="group rounded-[12px] border border-[color:var(--c-border)] bg-[color:var(--c-surface)]">
            <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 [&::-webkit-details-marker]:hidden">
                <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="shrink-0 text-[color:var(--c-text-dim)] transition-transform group-open:rotate-90"
                    aria-hidden
                >
                    <path d="M9 18l6-6-6-6" />
                </svg>
                <span className="text-[12px] font-bold uppercase tracking-[0.03em] text-[color:var(--c-text-muted)]">{title}</span>
                {count != null && (
                    <span className={cn("ml-auto rounded-full px-1.5 py-[1px] text-[10.5px] font-semibold", countTone ?? "bg-[color:var(--c-surface-2)] text-[color:var(--c-text-muted)]")}>{count}</span>
                )}
            </summary>
            <div className="border-t border-[color:var(--c-border)] px-3 py-2.5">{children}</div>
        </details>
    )
}

// ScoreBar is the merge-readiness headline: a big value, "/ max", and a
// max-segment bar filled to value, banded by ratio (strong=green / mid=amber /
// weak=rose) — the same visual the GitHub comment renders as an SVG.
function scoreBand(value: number, max: number): { text: string; bar: string; bg: string; empty: string } {
    const r = max > 0 ? value / max : 0
    return r >= 0.8
        ? { text: "text-emerald-700", bar: "bg-emerald-500", bg: "border-emerald-200 bg-emerald-50", empty: "bg-emerald-200/70" }
        : r >= 0.5
          ? { text: "text-amber-700", bar: "bg-amber-500", bg: "border-amber-200 bg-amber-50", empty: "bg-amber-200/70" }
          : { text: "text-rose-700", bar: "bg-rose-500", bg: "border-rose-200 bg-rose-50", empty: "bg-rose-200/70" }
}
function ScoreBar({ value, max }: { value: number; max: number }) {
    const b = scoreBand(value, max)
    return (
        <div className={cn("flex items-center gap-3 rounded-[12px] border px-3.5 py-2.5", b.bg)}>
            <div className="flex items-baseline gap-1">
                <span className={cn("text-[26px] font-bold leading-none tabular-nums", b.text)}>{value}</span>
                <span className={cn("text-[13px] font-semibold opacity-70", b.text)}>/ {max}</span>
            </div>
            <div className="flex flex-1 items-center gap-[3px]">
                {Array.from({ length: max }).map((_, i) => (
                    <span key={i} className={cn("h-4 flex-1 rounded-[3px]", i < value ? b.bar : b.empty)} />
                ))}
            </div>
            <span className={cn("shrink-0 text-[10px] font-bold uppercase tracking-[0.06em] opacity-80", b.text)}>readiness</span>
        </div>
    )
}

// Confidence meters: each dimension as a 3-stage bar (low→high), filled +
// labelled in its level's tone. Basis is the hover title.
// The FILL stays a literal — it is a saturated block, legible on either ground.
// The LABEL takes the token pairs: `text-amber-600` on the dark surface measured
// 1.39:1, well under the 4.5:1 floor, because a bare Tailwind colour cannot
// invert with the theme. Same trap as the callout tones above.
function meterTone(level: string): { fill: string; text: string } {
    return level === "high"
        ? { fill: "bg-emerald-500", text: "text-[color:var(--c-output-fg)]" }
        : level === "medium"
          ? { fill: "bg-amber-500", text: "text-[color:var(--c-warn)]" }
          : { fill: "bg-rose-500", text: "text-[color:var(--c-rose-fg)]" }
}
function Meter({ label, dim }: { label: string; dim: PrConfidenceDimension }) {
    const idx = dim.level === "high" ? 3 : dim.level === "medium" ? 2 : 1
    const t = meterTone(dim.level)
    return (
        <div className="flex items-center gap-2" title={dim.basis || undefined}>
            <span className="w-[76px] shrink-0 text-[11.5px] text-[color:var(--c-text-muted)]">{label}</span>
            <div className="flex items-center gap-[3px]">
                {[0, 1, 2].map((i) => (
                    <span key={i} className={cn("h-2 w-3.5 rounded-[2px]", i < idx ? t.fill : "bg-[color:var(--c-surface-3,#e7e5e0)]")} />
                ))}
            </div>
            <span className={cn("text-[11.5px] font-semibold", t.text)}>{dim.level}</span>
        </div>
    )
}
// The three dimensions, and the canonical order they read in when nobody asks
// for another. A `meters` block's `dims` both ORDERS and SUBSETS them, which is
// how a security-first profile gets security at the top without the renderer
// knowing anything about profiles.
const METER_DIMS = ["correctness", "load_perf", "security"] as const
const METER_LABEL: Record<(typeof METER_DIMS)[number], string> = {
    correctness: "correctness",
    load_perf: "load / perf",
    security: "security",
}

function ConfidenceMeters({ c, dims }: { c: PrConfidences; dims?: string[] }) {
    const wanted = dims?.length
        ? (dims.filter((d) => (METER_DIMS as readonly string[]).includes(d)) as (typeof METER_DIMS)[number][])
        : [...METER_DIMS]
    // An all-unknown `dims` would otherwise render an empty box; fall back rather
    // than silently dropping the confidence the review did calibrate.
    const shown = wanted.length > 0 ? wanted : [...METER_DIMS]
    return (
        <div className="flex flex-col gap-1.5">
            {shown.map((d) => (
                <Meter key={d} label={METER_LABEL[d]} dim={c[d]} />
            ))}
        </div>
    )
}

// The KB-verification tally (ADR-0057) — the diligence behind the review,
// rendered as a terse "Checked N callers · M precedents · …" line. Zero counts
// are omitted; nothing to show → nothing rendered.
//
// Since 0079 it also carries the LENS LINE, and that is the more important half.
// A profile whose lenses find nothing produces a review byte-identical to the
// default reviewer's, so "I set a security profile and the output looks the
// same" is indistinguishable from "the profile silently never applied" — a
// confusion this feature caused in practice before the line existed. Naming the
// lenses that ran answers it on the page, with no digging.
function ChecksFooter({ checks, findings, profile, build }: { checks: PrChecks | null; findings: PrFinding[]; profile: ReviewRunProfile | null; build?: string }) {
    const parts: string[] = []
    if (checks?.callers) parts.push(`${checks.callers} caller${checks.callers === 1 ? "" : "s"}`)
    if (checks?.precedents) parts.push(`${checks.precedents} precedent${checks.precedents === 1 ? "" : "s"}`)
    if (checks?.tests) parts.push(`${checks.tests} test${checks.tests === 1 ? "" : "s"}`)
    if (checks?.failure_probes) parts.push(`${checks.failure_probes} failure probe${checks.failure_probes === 1 ? "" : "s"}`)
    if (checks?.git_reads) parts.push(`${checks.git_reads} history read${checks.git_reads === 1 ? "" : "s"}`)

    // Which lenses ran is only knowable from the run's own snapshot. A row with
    // no attribution (pre-0079) gets NO lens line rather than a guessed one —
    // the same rule the profile chip follows, and for the same reason: a wrong
    // answer here is worse than none, because the whole point is to be trusted.
    const lenses = profile
        ? lensActivity(
              profile.kind === "profile" ? (profile.policy.lenses ?? []) : DEFAULT_LENSES,
              findings.map((f) => f.category).filter((c): c is string => !!c),
          )
        : []

    if (parts.length === 0 && !checks?.dropped && lenses.length === 0 && !build) return null
    return (
        <div className="flex flex-col gap-1 border-t border-[color:var(--c-border)] pt-2 text-[11px] text-[color:var(--c-text-dim)]">
            {(parts.length > 0 || checks?.dropped) && (
                <p>
                    {parts.length > 0 && <>Checked {parts.join(" · ")}</>}
                    {checks?.dropped ? <span className="text-[color:var(--c-text-muted)]">{parts.length > 0 ? " · " : ""}{checks.dropped} ungrounded dropped</span> : null}
                </p>
            )}
            {build ? (
                <p title="The analyser build that produced this review. Findings, layout and gating all move between builds, so this is what makes a stored review reproducible.">
                    <span className="text-[color:var(--c-text-muted)]">Analyser</span>{" "}
                    <code className="font-mono text-[10.5px] text-[color:var(--c-text-muted)]">{build}</code>
                </p>
            ) : null}
            {lenses.length > 0 && (
                <p title="The lenses this review ran. A number is how many findings that lens accounts for; a lens with no number ran and found nothing.">
                    <span className="text-[color:var(--c-text-muted)]">Lenses</span>{" "}
                    {lenses.map((l, i) => (
                        <Fragment key={l.key}>
                            {i > 0 && " · "}
                            {/* EVERY lens name gets the readable muted token, and
                                the count — not the label — carries the emphasis.
                                Dimming the lenses that found nothing was the
                                obvious first cut and exactly backwards: "security
                                ran and found nothing" is the sentence this line
                                exists to say, and it was landing in the lowest-
                                contrast text on the card (2.4:1). */}
                            <span className="text-[color:var(--c-text-muted)]">
                                {l.label.toLowerCase()}
                                {l.findings > 0 ? <span className="font-semibold text-[color:var(--c-text)]"> {l.findings}</span> : null}
                            </span>
                        </Fragment>
                    ))}
                </p>
            )}
        </div>
    )
}

// A rich finding card: severity + category + title + location on top, then the
// detail, a collapsible syntax-highlighted diff of the changed code, the cited
// evidence, and what the reviewer verified.
function Finding({ f, delta }: { f: PrFinding; delta?: DeltaFinding["delta"] | null }) {
    const loc = f.line && f.line > 0 ? `${f.file}:${f.line}` : f.file
    const title = (f.title && f.title.trim()) || f.detail
    const hasDetail = !!(f.title && f.title.trim() && f.detail && f.detail.trim() !== f.title.trim())
    const catLabel = f.category ? categoryLabel(f.category) : ""
    const evidence = (f.evidence ?? []).filter((a) => a.file).slice(0, 3)
    const snippet = f.snippet?.trim() ? "```" + (f.lang || "diff") + "\n" + f.snippet.trim() + "\n```" : ""
    return (
        <div className="rounded-[10px] border border-[color:var(--c-border)] bg-[color:var(--c-surface-2)] px-2.5 py-2">
            <div className="flex items-baseline gap-2">
                <span className={cn("shrink-0 rounded-full px-1.5 py-[1px] text-[10px] font-semibold uppercase tracking-wide", severityClasses(f.severity))}>
                    {severityLabel(f.severity)}
                </span>
                {catLabel && (
                    <span className="shrink-0 rounded-full bg-[color:var(--c-surface-3,#f1f1f1)] px-1.5 py-[1px] text-[9.5px] font-medium uppercase tracking-wide text-[color:var(--c-text-muted)]">
                        {catLabel}
                    </span>
                )}
                {/* Only NEW and BACK AGAIN earn a chip. Tagging every carried-over
                    finding "still open" would put a badge on most of the list and
                    say nothing — the interesting states are the ones that changed. */}
                {(delta === "new" || delta === "regressed") && <DeltaChip kind={delta} />}
                <span className="min-w-0 flex-1 text-[12.5px] font-medium leading-5 text-[color:var(--c-text)]">{title}</span>
                <code className="max-w-[42%] shrink-0 truncate font-mono text-[10.5px] text-[color:var(--c-text-muted)]" title={loc}>
                    {loc}
                </code>
            </div>

            {hasDetail && <p className="mt-1 text-[12px] leading-5 text-[color:var(--c-text-muted)]">{f.detail}</p>}

            {snippet && (
                <details className="group/snip mt-2">
                    <summary className="flex cursor-pointer list-none items-center gap-1 text-[11px] font-medium text-[color:var(--c-text-dim)] [&::-webkit-details-marker]:hidden">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="transition-transform group-open/snip:rotate-90" aria-hidden>
                            <path d="M9 18l6-6-6-6" />
                        </svg>
                        View change
                    </summary>
                    <div className="mt-1 overflow-x-auto rounded-[8px] border border-[color:var(--c-border)]">
                        <Md className="text-[11px] [&_pre]:my-0 [&_pre]:rounded-none [&_pre]:border-0">{snippet}</Md>
                    </div>
                </details>
            )}

            {evidence.length > 0 && (
                <ul className="mt-1.5 flex flex-col gap-0.5">
                    {evidence.map((a, i) => (
                        <li key={i} className="flex items-baseline gap-1 text-[11px] leading-5 text-[color:var(--c-text-dim)]">
                            <span aria-hidden>↳</span>
                            <code className="font-mono text-[10.5px] text-[color:var(--c-text-muted)]">
                                {a.line && a.line > 0 ? `${a.file}:${a.line}` : a.file}
                            </code>
                            {a.note && <span className="min-w-0 truncate">— {a.note}</span>}
                        </li>
                    ))}
                </ul>
            )}

            {f.checked && f.checked.length > 0 && (
                <p className="mt-1.5 flex items-baseline gap-1 text-[10.5px] leading-5 text-[color:var(--c-text-dim)]">
                    <span className="text-emerald-600" aria-hidden>✓</span>
                    <span className="min-w-0">Verified: {f.checked.slice(0, 3).join("; ")}</span>
                </p>
            )}
        </div>
    )
}

// DeepDiveButton opens the Mind chat seeded with this PR's session insight
// (analyser ADR-0055): it mints a conversation via the tracker route, then
// navigates to the Mind page with that conversation_id so the first turn is
// already grounded in the PR.
function DeepDiveButton({ insightId, projectId }: { insightId: string; projectId: string }) {
    const router = useRouter()
    const [busy, setBusy] = useState(false)
    const [err, setErr] = useState(false)

    async function open() {
        if (busy) return
        setBusy(true)
        setErr(false)
        try {
            const j = await apiMutate<{ conversation_id?: string; pr_number?: number; pr_title?: string }>(
                `/api/projects/${projectId}/pr-insight/deep-dive`,
                { method: "POST", body: { insight_id: insightId } },
            )
            if (!j?.conversation_id) throw new Error("no conversation")
            // Stash the PR reference so the Mind chat can open with a context bubble
            // + an auto-asked opener (read + cleared on arrival). Session-scoped.
            try {
                sessionStorage.setItem(
                    `bobby:deepdive:${j.conversation_id}`,
                    JSON.stringify({ number: j.pr_number, title: j.pr_title }),
                )
            } catch {}
            router.push(`/projects/${projectId}/mind?c=${encodeURIComponent(j.conversation_id)}`)
        } catch {
            setErr(true)
            setBusy(false)
        }
    }

    return (
        <div className="flex items-center gap-2">
            <button
                type="button"
                onClick={open}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--c-border)] bg-[color:var(--c-surface)] px-3 py-1 text-[12px] font-medium text-[color:var(--c-text)] transition-colors hover:border-[color:var(--c-border-strong)] hover:bg-[color:var(--c-surface-2)] disabled:opacity-50"
            >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M12 3a9 9 0 1 0 9 9" />
                    <path d="M12 7v5l3 2" />
                </svg>
                {busy ? "Opening…" : "Deep dive with Ucelot"}
            </button>
            {err && <span className="text-[11px] text-rose-600">Couldn&apos;t open</span>}
        </div>
    )
}
