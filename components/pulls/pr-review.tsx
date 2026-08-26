"use client"

import { Fragment, useLayoutEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import rehypeHighlight from "rehype-highlight"
import { cn } from "@/components/ui/cn"
import { severityLabel } from "@/lib/shared/rendering/badge"
import { findingState } from "@/lib/shared/rendering/finding-state"
import { apiMutate } from "@/lib/client/http/api-client"
import { layoutFor, type BlockKind, type BlockState, type BlockTone, type ReportBlock } from "@/lib/shared/report/registry"
import type { PrAnalysis, PrChecks, PrConfidenceDimension, PrConfidences, PrFinding, PullRequestAnalysis, ReviewRoundCommit, ReviewRunProfile, ReviewRunScope } from "@/lib/shared/types"
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
        <section className="rounded-[16px] border border-[color:var(--c-border)] bg-[color:var(--c-surface)] p-5 shadow-[var(--shadow-card)] sm:p-6">
            <div className="mb-4 flex items-center gap-2">
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
            {/* One rhythm for everything the panel stacks. These used to be bare
                siblings — RoundStrip, the in-flight and progress banners, then
                the review body — so their spacing was whatever margin each
                happened to carry, which for most of them was none. Five full
                width bars touching each other reads as one dense block rather
                than as five things. */}
            <div className="flex flex-col gap-3.5">{children}</div>
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

/** One completed review of one head, as the panel reads it — a SNAPSHOT.
 *
 *  Every round holds its own complete findings list, which is what makes the
 *  selector below a row read rather than a replay engine: switching to round 2
 *  renders round 2's stored answer, not a state rebuilt from a chain of diffs
 *  that might have drifted from what the merge gate actually saw that day. */
export interface RoundSummary {
    headSha: string
    round: number
    verdict: string | null
    score: number | null
    scoreMax: number | null
    findings: PrFinding[]
    degraded: boolean
    scope: "full" | "incremental"
    scopeReason: string | null
    commits: ReviewRoundCommit[]
    carriedCount: number
    resolved: PrFinding[]
    createdAt: string
    /** Blockers the previous round had that this one does not — precomputed by
     *  the route from `resolved`, so the strip does not re-derive it. */
    fixed: number
    blockers: number
}

/** One round per push, oldest first — the panel's memory, and a SELECTOR.
 *
 *  It exists because a re-review used to replace the last one, so a developer
 *  who had just fixed three of five blockers saw a fresh verdict with no sign
 *  that anything had moved. Choosing a round renders the review exactly as it
 *  stood at that head — its verdict, its score, its findings, including the ones
 *  later fixed. That is the point: a reader can see what the review said BEFORE
 *  their fix, which is the only way to check that the fix addressed what was
 *  actually reported rather than what they remembered being reported. */
/** How wide a round has to be to be worth reading, and how wide one is when it
 *  is not being read. A closed round is a SLIVER: a dot and a number, which is
 *  the honest amount of information for something you are not looking at. */
const SLIVER_W = 22
/** Narrow enough that a round number no longer fits; below this a sliver shows
 *  its dot alone rather than half a digit. */
const SLIVER_NUM_W = 18
/** The floor. A dot plus its ring needs this much to read as a dot. */
const SLIVER_MIN = 8
const READABLE_W = 232
const STRIP_GAP = 6

function RoundStrip({ rounds, selected, onSelect }: { rounds: RoundSummary[]; selected: number | null; onSelect: (round: number | null) => void }) {
    const rowRef = useRef<HTMLDivElement | null>(null)
    const [width, setWidth] = useState(0)

    // Measured, not a breakpoint: the strip's width depends on the panel it is
    // in, not on the viewport, so a media query would answer about the wrong
    // element.
    // Layout effect, not effect: every width below is derived from this number,
    // so measuring after paint means the first frame is laid out in ignorance
    // and then animated away from.
    useLayoutEffect(() => {
        const el = rowRef.current
        if (!el) return
        setWidth(el.getBoundingClientRect().width)
        if (typeof ResizeObserver === "undefined") return
        const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width))
        ro.observe(el)
        return () => ro.disconnect()
    }, [])

    if (rounds.length < 2) return null // one round is not a story

    const lastIdx = rounds.length - 1
    const latest = rounds[lastIdx].round
    const selIdx = Math.max(0, rounds.findIndex((r) => r.round === (selected ?? latest)))
    const gaps = (rounds.length - 1) * STRIP_GAP
    const slivers = Math.max(1, rounds.length - 1)

    // ONE card open — the selected one. Opening the current one alongside it
    // read well at five rounds and stopped fitting past that, and a strip whose
    // job is "every round is on screen" cannot afford a second readable card.
    const open = new Set<number>([selIdx])

    // Widths are grow weights over a zero basis, never a basis to be shrunk:
    // flex hands out free space by weight, so weights that sum to the free space
    // land on exactly these widths and CANNOT overflow. There is no oversized
    // basis for the browser to claw back, which is what used to squeeze the open
    // card once the round count climbed.
    const free = Math.max(0, width - gaps)
    const sliverW = free > 0 ? Math.max(SLIVER_MIN, Math.min(SLIVER_W, (free - READABLE_W) / slivers)) : SLIVER_W
    // The open card takes whatever the slivers left: a full READABLE_W while
    // that fits, and past that, what remains once every round has its dot. It
    // gives way before the strip does.
    const openW = free > 0 ? Math.max(0, free - slivers * sliverW) : READABLE_W
    // A number that cannot fit is dropped, not clipped.
    const showNumber = sliverW >= SLIVER_NUM_W

    return (
        <div ref={rowRef} className="flex min-h-[78px] w-full" style={{ gap: STRIP_GAP }}>
            {/* Nothing until the row has been measured — the tiles' widths come
                from that measurement, and the reserved height means waiting a
                frame for it costs no layout jump. */}
            {width > 0 && rounds.map((r, i) => {
                const isOpen = open.has(i)
                const isLatest = r.round === latest
                const isSelected = i === selIdx
                const commit = r.commits[r.commits.length - 1]
                const tone = r.degraded ? "bg-[color:var(--c-warn)]" : r.blockers > 0 ? "bg-[color:var(--c-error)]" : "bg-[color:var(--c-success)]"
                return (
                    <button
                        key={r.headSha + r.round}
                        type="button"
                        onClick={() => onSelect(isLatest ? null : r.round)}
                        aria-expanded={isOpen}
                        aria-pressed={isSelected}
                        aria-label={`Round ${r.round}${isLatest ? " (current)" : ""}`}
                        title={r.scopeReason ?? undefined}
                        style={{ flexGrow: isOpen ? openW : sliverW, flexBasis: 0, minWidth: 0 }}
                        className={cn(
                            "flex min-w-0 cursor-pointer flex-col overflow-hidden rounded-[10px] border text-left",
                            "transition-[flex-grow,background-color,border-color,opacity] duration-300 ease-out",
                            isOpen
                                ? "items-stretch justify-start bg-[color:var(--c-surface-2)] px-2.5 py-2"
                                : "items-center justify-center gap-1 px-0 py-2 opacity-70 hover:opacity-100",
                            isSelected
                                ? "border-[color:var(--c-primary)] ring-1 ring-inset ring-[color:var(--c-primary)]/40"
                                : isOpen
                                  ? "border-[color:var(--c-border-strong)]"
                                  : "border-[color:var(--c-border)]",
                        )}
                    >
                        {isOpen ? (
                            <>
                                <div className="flex items-center gap-1.5">
                                    <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", tone)} />
                                    <span className="shrink-0 text-[11px] font-semibold text-[color:var(--c-text-muted)]">{r.round}</span>
                                    <code className="truncate font-mono text-[11px] text-[color:var(--c-text-dim)]">{r.headSha.slice(0, 7)}</code>
                                    {isLatest && (
                                        <span className="ml-auto shrink-0 text-[9.5px] font-bold uppercase tracking-[0.06em] text-[color:var(--c-text-dim)]">
                                            current
                                        </span>
                                    )}
                                </div>
                                {/* One line, never wrapped. A card animating from a
                                    sliver passes through every width in between, and
                                    chips that restack make it taller at the narrow
                                    end — which is the row jumping mid-transition. */}
                                <div className="mt-1 flex min-w-0 items-center gap-1">
                                    <span className="truncate text-[12px] font-semibold leading-4">{r.verdict ? verdictLabel(r.verdict) : "—"}</span>
                                    <span className="flex shrink-0 gap-1">
                                        {r.degraded && <DeltaChip kind="partial" />}
                                        {r.fixed > 0 && <DeltaChip kind="fixed" n={r.fixed} />}
                                        {r.blockers > 0 && <DeltaChip kind="blockers" n={r.blockers} />}
                                        {!r.degraded && r.blockers === 0 && <DeltaChip kind="clear" />}
                                        {r.carriedCount > 0 && <DeltaChip kind="carried" n={r.carriedCount} />}
                                    </span>
                                </div>
                                {/* The commit under the round, so the strip doubles as
                                    the series of pushes: a bare sha says which head,
                                    this says which CHANGE the review was answering. */}
                                {commit && (
                                    <span className="mt-1 truncate text-[10.5px] leading-4 text-[color:var(--c-text-dim)]" title={commit.subject}>
                                        {commit.subject}
                                    </span>
                                )}
                            </>
                        ) : (
                            <>
                                <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", tone)} />
                                {showNumber && (
                                    <span className="text-[10.5px] font-semibold tabular-nums text-[color:var(--c-text-muted)]">{r.round}</span>
                                )}
                            </>
                        )}
                    </button>
                )
            })}
        </div>
    )
}


/** What is being reviewed RIGHT NOW, while it is being reviewed.
 *
 *  The panel used to replace the whole review with a spinner the moment a push
 *  landed, which is the worst possible moment to take it away: the reader has
 *  just pushed a fix and wants to know what it was answering. Worse, the review
 *  it hid was still the truth — the merge gate was still reading it, and the
 *  page was showing nothing.
 *
 *  So the last completed round stays on screen, and this says what is happening
 *  above it. The commits come from the scope written at DISPATCH, so the panel
 *  can name them before the reviewer has said a word about them. */
function InFlightBanner({ scope, standing, queued }: { scope: ReviewRunScope | null; standing: RoundSummary | null; queued?: boolean }) {
    const commits = scope?.commits ?? []
    const incremental = scope?.scope === "incremental"
    const carried = scope?.carried?.length ?? 0

    return (
        <div className="flex flex-col gap-1.5 rounded-[10px] border border-[color:var(--c-warn)]/30 bg-[color:var(--c-warn-bg)] px-3 py-2 text-[12px] text-[color:var(--c-warn)]">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <Spinner />
                <span className="font-semibold">
                    {queued
                        ? "Queued — waiting for a review slot"
                        : commits.length > 0
                          ? `Reviewing ${commits.length} new commit${commits.length === 1 ? "" : "s"}`
                          : "Ucelot is reviewing this pull request"}
                </span>
                {incremental && (
                    <span className="opacity-85">
                        — the push only{carried > 0 ? `, carrying ${carried} finding${carried === 1 ? "" : "s"} forward` : ""}
                    </span>
                )}
                {scope && !incremental && <span className="opacity-85">— the whole pull request</span>}
            </span>

            {/* Why it is reviewing everything, when it had a round to build on.
                Without this the answer to "why is there no commit list?" is
                indistinguishable from "the feature is not working" — and one of
                those is a broken compare that nothing else would report. */}
            {scope && !incremental && standing && (
                <span className="opacity-85">{scope.reason}</span>
            )}

            {commits.length > 0 && (
                <ul className="flex flex-col gap-0.5 pl-5">
                    {commits.slice(0, 5).map((c) => (
                        <li key={c.sha} className="flex items-baseline gap-2 opacity-90">
                            <code className="shrink-0 font-mono text-[10.5px]">{c.sha.slice(0, 7)}</code>
                            <span className="min-w-0 flex-1 truncate" title={c.subject}>{c.subject}</span>
                        </li>
                    ))}
                    {commits.length > 5 && <li className="pl-1 opacity-75">…and {commits.length - 5} more</li>}
                </ul>
            )}

            {standing && (
                <span className="opacity-85">
                    Round {standing.round} is below and still stands until this finishes — it is what the merge gate is reading.
                </span>
            )}
        </div>
    )
}

function Spinner() {
    return (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" className="shrink-0 animate-spin" aria-hidden>
            <path d="M21 12a9 9 0 1 1-6.2-8.6" />
        </svg>
    )
}

/** The banner that appears when a reader has stepped back into history.
 *
 *  Loud on purpose. A stale review rendered without a frame around it is how
 *  somebody acts on a blocker that was fixed two pushes ago. */
function ArchiveBanner({ round, onBack }: { round: RoundSummary; onBack: () => void }) {
    return (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[10px] border border-[color:var(--c-info-fg)]/25 bg-[color:var(--c-info-bg)] px-3 py-2 text-[12px] text-[color:var(--c-info-fg)]">
            <span className="font-semibold">Viewing round {round.round}</span>
            <span className="opacity-80">
                — the review as it stood at <code className="font-mono">{round.headSha.slice(0, 7)}</code>. Some of it may since have been fixed.
            </span>
            <button type="button" onClick={onBack} className="ml-auto shrink-0 cursor-pointer font-semibold underline underline-offset-2">
                Back to the current review
            </button>
        </div>
    )
}

/** An earlier round, rendered from its own stored snapshot.
 *
 *  Deliberately thinner than the live review: a round stores its verdict, score
 *  and findings, not the narrative blocks around them. Rendering a summary here
 *  would mean either storing a second copy of the whole result or reconstructing
 *  prose that nobody wrote — and the question this view answers is "what did the
 *  review say I had to fix", which the findings answer on their own. */
function RoundSnapshot({ round }: { round: RoundSummary }) {
    const groups: BlockState[] = ["critical", "review", "good"]
    return (
        <div className="flex flex-col gap-4">
            {round.verdict && (
                <div className={cn("flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[10px] border px-3 py-2", verdictBannerClasses(round.verdict))}>
                    <span className="inline-flex items-center gap-1.5 text-[13px] font-bold">
                        <VerdictIcon v={round.verdict} />
                        {verdictLabel(round.verdict)}
                    </span>
                </div>
            )}
            {typeof round.score === "number" && round.scoreMax ? <ScoreBar value={round.score} max={round.scoreMax} /> : null}
            <PushSummary round={round} />
            {groups.map((state) => {
                const items = round.findings.filter((f) => findingState(f.severity) === state)
                if (items.length === 0) return null
                const style = GROUP_STYLE[state]
                return (
                    <Group key={state} title={style.title} count={items.length} state={state}>
                        <div className="divide-y divide-[color:var(--c-border)]">
                            {items.map((f, i) => (
                                <Finding key={i} f={f} />
                            ))}
                        </div>
                    </Group>
                )
            })}
            {round.resolved.length > 0 && (
                <Section title="Resolved by this push" count={round.resolved.length} countTone="bg-[color:var(--c-output-bg)] text-[color:var(--c-output-fg)]" defaultOpen={false}>
                    <div className="flex flex-col gap-2.5">
                        {round.resolved.map((f, i) => (
                            <Finding key={i} f={f} />
                        ))}
                    </div>
                </Section>
            )}
        </div>
    )
}

/** What a round actually looked at: the commits behind it, and — when it was
 *  scoped to the push — why. Collapsed, because it is provenance rather than
 *  the answer somebody came for. */
function PushSummary({ round }: { round: RoundSummary | null }) {
    if (!round) return null

    // No commits recorded means the provider could not be asked what this round
    // covered — which is also why it reviewed everything. Rendering nothing here
    // would hide the one fact that explains the round.
    if (round.commits.length === 0) {
        if (!round.scopeReason || round.round === 1) return null
        return (
            <p className="rounded-[8px] border border-[color:var(--c-border)] bg-[color:var(--c-surface-2)] px-3 py-1.5 text-[11.5px] text-[color:var(--c-text-muted)]">
                Reviewed the whole pull request — {round.scopeReason}
            </p>
        )
    }

    const label = round.scope === "incremental" ? "Reviewed this push" : "Commits in this round"
    return (
        <Section title={label} count={round.commits.length} defaultOpen={false}>
            <ul className="flex flex-col gap-1">
                {round.commits.slice(0, 20).map((c) => (
                    <li key={c.sha} className="flex items-baseline gap-2 text-[12px]">
                        <code className="shrink-0 font-mono text-[10.5px] text-[color:var(--c-text-muted)]">{c.sha.slice(0, 7)}</code>
                        <span className="min-w-0 flex-1 truncate text-[color:var(--c-text)]" title={c.subject}>
                            {c.subject}
                        </span>
                        {c.author && <span className="shrink-0 text-[10.5px] text-[color:var(--c-text-dim)]">{c.author}</span>}
                    </li>
                ))}
            </ul>
            {round.scopeReason && <p className="mt-2 text-[11px] leading-4 text-[color:var(--c-text-dim)]">{round.scopeReason}</p>}
        </Section>
    )
}

/** The "N carried" chip, expanded.
 *
 *  Without this a cheap round looks like a lazy one and the reader has no way to
 *  tell the difference. It names which findings rode along, when each was last
 *  actually verified, and states the rule that made carrying them safe — so
 *  somebody deciding whether to trust a two-minute review can check the
 *  reasoning rather than the vibe. */
function CarriedNote({ findings }: { findings: PrFinding[] }) {
    const carried = findings.filter((f) => f.provenance?.carried === true)
    if (carried.length === 0) return null
    return (
        <Section title="Carried forward" count={carried.length} countTone="bg-[color:var(--c-surface-2)] text-[color:var(--c-text-muted)]" defaultOpen={false}>
            <p className="text-[11.5px] leading-5 text-[color:var(--c-text-muted)]">
                This round reviewed only what the push changed. These findings were reported earlier, their files were not touched, and no symbol
                they name was changed elsewhere — so they are still there, and nothing needed to be asked.
            </p>
            <ul className="flex flex-col gap-1.5">
                {carried.map((f, i) => (
                    <li key={i} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[12px]">
                        <span className={cn("shrink-0 rounded-full px-1.5 py-[1px] text-[10px] font-semibold uppercase tracking-wide", severityClasses(f.severity))}>
                            {severityLabel(f.severity)}
                        </span>
                        <span className="min-w-0 flex-1 text-[color:var(--c-text)]">{(f.title && f.title.trim()) || f.detail}</span>
                        <span className="shrink-0 text-[10.5px] text-[color:var(--c-text-dim)]">
                            first seen round {f.provenance?.firstSeenRound ?? "?"} · last verified round {f.provenance?.lastVerifiedRound ?? "?"}
                        </span>
                    </li>
                ))}
            </ul>
        </Section>
    )
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
    // Neutral, not a warning. A carried finding is not a defect in the review —
    // it is a finding the round proved it did not need to re-open. Colouring it
    // like a problem would teach readers to distrust the cheap rounds, which are
    // the ones this whole feature exists to make possible.
    carried:   { label: "carried",    cls: "bg-[color:var(--c-surface-2)] text-[color:var(--c-text-muted)]" },
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
    // Which round the reader is looking at. `null` is the LIVE review rather
    // than "the latest round", and the difference matters: the live row carries
    // the narrative blocks a round snapshot does not store, so defaulting to a
    // round number would quietly downgrade the default view.
    const [viewing, setViewing] = useState<number | null>(null)

    const status = analysis?.status ?? null
    const result = analysis?.result ?? null
    const profile = analysis?.review_profile ?? null

    // Derived before the status branches, because the in-flight state needs them
    // too: a re-review must not take the standing review off the page.
    const archived = viewing != null ? (rounds.find((r) => r.round === viewing) ?? null) : null
    const latest = rounds.length > 0 ? rounds[rounds.length - 1] : null

    // Queued belongs here, not with the terminal states: a review that has not
    // started yet is still coming, and the standing round must stay on the page
    // for the same reason it does while one runs.
    if (status === "analysing" || status === "queued") {
        return (
            <Shell profile={profile}>
                <RoundStrip rounds={rounds} selected={viewing} onSelect={setViewing} />
                <InFlightBanner scope={analysis?.review_scope ?? null} standing={archived ?? latest} queued={status === "queued"} />
                {archived ? (
                    <>
                        <ArchiveBanner round={archived} onBack={() => setViewing(null)} />
                        <RoundSnapshot round={archived} />
                    </>
                ) : latest ? (
                    <RoundSnapshot round={latest} />
                ) : (
                    <Placeholder tone="amber" text="Nothing has been reviewed yet — this panel fills in automatically." />
                )}
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
            <RoundStrip rounds={rounds} selected={viewing} onSelect={setViewing} />
            {archived ? (
                <>
                    <ArchiveBanner round={archived} onBack={() => setViewing(null)} />
                    <RoundSnapshot round={archived} />
                </>
            ) : (
                <>
                    <ProgressLine delta={delta} />
                    <PushSummary round={latest} />
                    <CarriedNote findings={result.findings ?? []} />
                    <Review r={result} projectId={analysis?.project_id ?? null} profile={profile} delta={delta} />
                </>
            )}
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
            <Group title={b.title || "Confidence"}>
                <ConfidenceMeters c={r.confidences} dims={b.dims} />
            </Group>
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
                <Group title={b.title || "Impact"}>
                    <Md className="text-[13px] leading-6">{r.impact}</Md>
                </Group>
            )
        }
        // "note" — the one prose role that carries its own text, for a lens that
        // wants to say something no canonical field holds.
        return !b.body?.trim() ? null : (
            <Group title={b.title || "Note"}>
                <Md className="text-[13px] leading-6">{b.body}</Md>
            </Group>
        )
    },

    finding_group: ({ b, r, delta }) => {
        const state = b.state ?? "review"
        const items = (r.findings ?? []).filter((f) => findingState(f.severity) === state)
        if (items.length === 0) return null
        const style = GROUP_STYLE[state] ?? GROUP_STYLE.review
        return (
            <Group title={b.title || style.title} count={items.length} state={state}>
                <div className="divide-y divide-[color:var(--c-border)]">
                    {items.map((f, i) => (
                        <Finding key={i} f={f} delta={deltaOf(delta, f)} />
                    ))}
                </div>
            </Group>
        )
    },

    file_impact_list: ({ b, r }) => {
        const files = r.impact_files ?? []
        if (files.length === 0) return null
        return (
            <Group title={b.title || "Affected files"} count={files.length}>
                <ul className="flex flex-col gap-2">
                    {files.map((f, i) => (
                        <li key={i} className="min-w-0 text-[12px] leading-[1.5]">
                            <code className="block truncate font-mono text-[11px] text-[color:var(--c-text)]" title={f.file}>{f.file}</code>
                            <span className="text-[11px] text-[color:var(--c-text-dim)]">{f.reason}</span>
                        </li>
                    ))}
                </ul>
            </Group>
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

    checks_footer: ({ b, r, profile }) => (
        <Group title={b.title || "Checked"}>
            <ChecksFooter checks={r.checks ?? null} findings={r.findings ?? []} profile={profile} build={r.analyser_build} />
        </Group>
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
                    <table className="w-full min-w-max text-left text-[12px]">
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
                                        <td key={j} className="whitespace-nowrap border-b border-[color:var(--c-border)] py-1.5 pr-3 align-top leading-5 text-[color:var(--c-text-muted)]">
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
/** Which blocks are REFERENCE rather than review.
 *
 *  Confidence, the files touched and the checks ledger are things a reader
 *  consults; findings and the verdict are things a reader acts on. In one column
 *  the reference material pushed the last findings below the fold for content
 *  nobody was triaging, so it moves to a rail beside them.
 *
 *  Order is preserved WITHIN each column, so a profile that puts security first
 *  still gets security first. What a profile cannot express — and does not try
 *  to — is which column a block belongs in: that is a property of the kind, not
 *  of the review. */
const RAIL_KINDS = new Set(["meters", "file_impact_list", "checks_footer"])

/** And which are the HEADLINE — the answer to "can I merge", which is the one
 *  question every reader arrives with. These span the full width above the
 *  columns rather than being squeezed into one of them: a verdict wrapped into a
 *  narrow column reads as a caption, not as a verdict. */
const HEADER_KINDS = new Set(["verdict_banner", "score", "tally", "callout"])

function Review({ r, projectId, profile, delta }: { r: PrAnalysis; projectId: string | null; profile: ReviewRunProfile | null; delta?: RoundDelta | null }) {
    const layout = layoutFor(r.report)
    const draw = (b: (typeof layout)[number], i: number) => {
        const render = BLOCKS[b.kind]
        // Belt to the registry filter's braces: layoutFor already drops kinds we
        // don't know, but this render path is the one place a newer analyser's
        // vocabulary reaches the browser.
        if (!render) return null
        return <Fragment key={i}>{render({ b, r, projectId, profile, delta: delta ?? null })}</Fragment>
    }

    const header = layout.filter((b) => HEADER_KINDS.has(b.kind))
    const main = layout.filter((b) => !RAIL_KINDS.has(b.kind) && !HEADER_KINDS.has(b.kind))
    const rail = layout.filter((b) => RAIL_KINDS.has(b.kind))

    return (
        <div className="flex flex-col gap-4">
            {header.length > 0 && <div className="flex flex-col gap-3">{header.map(draw)}</div>}
            <div className={cn("grid gap-6", rail.length > 0 && "lg:grid-cols-[minmax(0,1fr)_252px]")}>
                <div className="flex min-w-0 flex-col gap-5">{main.map(draw)}</div>
                {rail.length > 0 && (
                    <aside className="flex flex-col divide-y divide-[color:var(--c-border)] [&>*]:py-4 [&>*:first-child]:pt-0 [&>*:last-child]:pb-0">
                        {rail.map(draw)}
                    </aside>
                )}
            </div>

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
/** A heading over its content, with a coloured rail when the content is
 *  findings.
 *
 *  The panel used to put twelve near-identical <details> boxes in a column, so a
 *  critical blocker carried exactly the weight of "nice to check" and telling
 *  them apart meant opening drawers. A group that is always open does not need
 *  a disclosure around it; it needs a heading you can find. The rail also
 *  answers "how far do the blockers go" from the edge of the column, without
 *  reading a word.
 *
 *  Section survives for the blocks that ARE collapsed by default — the commit
 *  list, carried-forward, resolved — where hiding the content is the point. */
const GROUP_RAIL: Record<string, string> = {
    critical: "border-[color:var(--c-error)]/45",
    review: "border-[color:var(--c-warn)]/45",
    good: "border-[color:var(--c-success)]/45",
}
const GROUP_TEXT: Record<string, string> = {
    critical: "text-[color:var(--c-error)]",
    review: "text-[color:var(--c-warn)]",
    good: "text-[color:var(--c-success)]",
}

function Group({
    title,
    count,
    state,
    children,
}: {
    title: string
    count?: number
    /** Findings groups take their severity's rail and label colour. Absent for
     *  everything else, which gets a plain heading. */
    state?: string
    children: React.ReactNode
}) {
    const rail = state ? GROUP_RAIL[state] : undefined
    return (
        <div className={cn(rail && "border-l-2 pl-3.5", rail)}>
            <h3
                className={cn(
                    "mb-2.5 flex items-center gap-2 text-[13.5px] font-bold uppercase tracking-[0.05em]",
                    state ? GROUP_TEXT[state] : "text-[color:var(--c-text-muted)]",
                )}
            >
                {title}
                {count != null && (
                    <span className="rounded-full bg-[color:var(--c-surface-2)] px-1.5 py-[1px] text-[11px] font-bold normal-case tracking-normal tabular-nums text-[color:var(--c-text-muted)]">
                        {count}
                    </span>
                )}
            </h3>
            {children}
        </div>
    )
}

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
            <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 [&::-webkit-details-marker]:hidden">
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
            <div className="border-t border-[color:var(--c-border)] px-4 py-3.5">{children}</div>
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
                    <span key={i} className={cn("h-2 w-3.5 rounded-[2px]", i < idx ? t.fill : "bg-[color:var(--c-surface-2)]")} />
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
        <div className="flex flex-col gap-2">
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
        <div className="flex flex-col gap-1.5 text-[11px] leading-[1.6] text-[color:var(--c-text-dim)]">
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
    // The tail is what a reader recognises; the directories are how a file is
    // FOUND, not what it is. Full path stays on the title attribute.
    const shortLoc = `${f.file?.split("/").pop() ?? ""}${f.line && f.line > 0 ? `:${f.line}` : ""}`
    const title = (f.title && f.title.trim()) || f.detail
    const hasDetail = !!(f.title && f.title.trim() && f.detail && f.detail.trim() !== f.title.trim())
    const catLabel = f.category ? categoryLabel(f.category) : ""
    const evidence = (f.evidence ?? []).filter((a) => a.file).slice(0, 3)
    const snippet = f.snippet?.trim() ? "```" + (f.lang || "diff") + "\n" + f.snippet.trim() + "\n```" : ""
    const state = findingState(f.severity)
    const dot = state === "critical" ? "bg-[color:var(--c-error)]" : state === "good" ? "bg-[color:var(--c-success)]" : "bg-[color:var(--c-warn)]"

    // No box. A finding carries four kinds of information and they used to be
    // rendered at nearly one weight inside a card, which reads as a wall. Ranked
    // and indented, the eye can travel down TITLES alone and stop where it
    // matters.
    return (
        <div className="py-3.5">
            {/* 1 — the title, alone at the left edge and the only thing at full
                contrast. Chips ride with it because they qualify it. */}
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className={cn("h-2 w-2 shrink-0 rounded-full", dot)} aria-hidden />
                <span className="text-[14px] font-semibold leading-[1.35] text-[color:var(--c-text)]">{title}</span>
                {catLabel && (
                    <span className="shrink-0 rounded-full bg-[color:var(--c-surface-2)] px-1.5 py-[1px] text-[9.5px] font-semibold uppercase tracking-[0.05em] text-[color:var(--c-text-dim)]">
                        {catLabel}
                    </span>
                )}
                {/* Only NEW and BACK AGAIN earn a chip. Tagging every carried-over
                    finding "still open" would put a badge on most of the list and
                    say nothing — the interesting states are the ones that changed. */}
                {(delta === "new" || delta === "regressed") && <DeltaChip kind={delta} />}
                {/* Carried findings are the one case where a chip on a
                    still-open finding earns its place: it is the difference
                    between "somebody read this code again this round" and "this
                    rode along because nothing it depends on moved". */}
                {f.provenance?.carried === true && <DeltaChip kind="carried" />}
            </div>

            <div className="mt-1 pl-4">
                {/* 2 — where. Its own line rather than fighting the title for the
                    right edge, and shortened so a column of these is scannable. */}
                <code className="font-mono text-[10.5px] text-[color:var(--c-text-dim)]" title={loc}>
                    {shortLoc}
                </code>

                {/* 3 — why. The only prose, at reading measure. */}
                {hasDetail && <p className="mt-1 max-w-[68ch] text-[12.5px] leading-[1.65] text-[color:var(--c-text-muted)]">{f.detail}</p>}

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

                {/* 4 — what was checked, as a citation list. The NOTE leads and the
                    location follows: the other way round put a sixty-character
                    path in front of the four words that say why it matters. */}
                {evidence.length > 0 && (
                    <ul className="mt-2 flex flex-col gap-[3px] border-l border-[color:var(--c-border)] pl-2.5">
                        {evidence.map((a, i) => (
                            <li key={i} className="flex flex-wrap items-baseline gap-x-1.5 text-[11px] leading-[1.5]">
                                {a.note && <span className="text-[color:var(--c-text-muted)]">{a.note}</span>}
                                <code
                                    className="font-mono text-[10px] text-[color:var(--c-text-dim)]"
                                    title={a.line && a.line > 0 ? `${a.file}:${a.line}` : a.file}
                                >
                                    {`${a.file?.split("/").pop() ?? ""}${a.line && a.line > 0 ? `:${a.line}` : ""}`}
                                </code>
                            </li>
                        ))}
                    </ul>
                )}

                {f.checked && f.checked.length > 0 && (
                    <p className="mt-1.5 flex items-baseline gap-1 text-[10.5px] leading-5 text-[color:var(--c-text-dim)]">
                        <span className="text-[color:var(--c-success)]" aria-hidden>✓</span>
                        <span className="min-w-0">Verified: {f.checked.slice(0, 3).join("; ")}</span>
                    </p>
                )}
            </div>
        </div>
    )
}

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
                className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--c-border)] bg-[color:var(--c-surface)] px-3.5 py-1.5 text-[12px] font-medium text-[color:var(--c-text)] transition-colors hover:border-[color:var(--c-border-strong)] hover:bg-[color:var(--c-surface-2)] disabled:opacity-50"
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
