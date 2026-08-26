"use client"
import { useLayoutEffect, useRef, useState } from "react"

import type { PrAnalysis, PrFinding } from "@/lib/shared/types"
import { cn } from "@/components/ui/cn"
import { Icon, type IconName } from "./glyphs"

// Shared pieces for the redesign proposals. Deliberately small and local: this
// is a proposal, so nothing here touches the shipped panel until a direction is
// chosen.

export const SEV = {
    critical: { dot: "bg-[color:var(--c-error)]", text: "text-[color:var(--c-error)]", chip: "bg-[color:var(--c-error-bg)] text-[color:var(--c-error)] ring-[color:var(--c-error)]/30", label: "Blocker", icon: "alert" as IconName, rail: "border-[color:var(--c-error)]/45" },
    review: { dot: "bg-[color:var(--c-warn)]", text: "text-[color:var(--c-warn)]", chip: "bg-[color:var(--c-warn-bg)] text-[color:var(--c-warn)] ring-[color:var(--c-warn)]/30", label: "Worth a look", icon: "search" as IconName, rail: "border-[color:var(--c-warn)]/45" },
    good: { dot: "bg-[color:var(--c-success)]", text: "text-[color:var(--c-success)]", chip: "bg-[color:var(--c-success-bg)] text-[color:var(--c-success)] ring-[color:var(--c-success)]/30", label: "Good", icon: "check" as IconName, rail: "border-[color:var(--c-success)]/45" },
} as const

export type Sev = keyof typeof SEV
export const sevOf = (f: PrFinding): Sev =>
    f.severity === "critical" || f.severity === "bug" ? "critical" : f.severity === "good" ? "good" : "review"

/** The one thing a reader is here for, said once, at full size. */
export function VerdictBand({ r }: { r: PrAnalysis }) {
    const blocking = r.verdict === "request_changes"
    const tone = blocking
        ? "border-[color:var(--c-error)]/30 bg-[color:var(--c-error-bg)] text-[color:var(--c-error)]"
        : r.verdict === "approve"
          ? "border-[color:var(--c-success)]/30 bg-[color:var(--c-success-bg)] text-[color:var(--c-success)]"
          : "border-[color:var(--c-border)] bg-[color:var(--c-surface-2)] text-[color:var(--c-text)]"
    const blockers = (r.findings ?? []).filter((f) => sevOf(f) === "critical").length
    const icon: IconName = blocking ? "x" : r.verdict === "approve" ? "check" : "chat"
    return (
        <div className={cn("rounded-[14px] border px-4 py-3.5", tone)}>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <Icon name={icon} size={18} />
                <span className="text-[17px] font-bold tracking-[-0.01em]">
                    {blocking ? "Changes requested" : r.verdict === "approve" ? "Looks good to merge" : "Reviewed"}
                </span>
                <span className="text-[13px] opacity-80">{r.verdict_reason}</span>
                {blockers > 0 && (
                    <span className="ml-auto rounded-full bg-[color:var(--c-surface)]/70 px-2 py-[3px] text-[11.5px] font-semibold ring-1 ring-[color:var(--c-error)]/30">
                        {blockers} blocker{blockers === 1 ? "" : "s"}
                    </span>
                )}
            </div>
            <ScoreBar value={r.score ?? 0} max={r.score_max ?? 10} />
        </div>
    )
}

/** A finding, with severity carried by a rail rather than by a badge inside a
 *  box inside a drawer. */
export function FindingRow({ f, rail }: { f: PrFinding; rail?: boolean }) {
    const s = SEV[sevOf(f)]
    // The path a reader recognises is the tail; the directories are how it is
    // FOUND, not what it is. Full path on hover, so nothing is lost.
    const short = (file?: string, line?: number) => `${file?.split("/").pop() ?? ""}${line ? `:${line}` : ""}`
    return (
        <div className={cn("relative py-3.5", rail && "pl-5")}>
            {rail && <span className={cn("absolute left-0 top-[20px] h-2 w-2 rounded-full ring-4 ring-[color:var(--c-surface)]", s.dot)} />}

            {/* Level 1 — the only thing at the left edge, and the only thing at
                full contrast. This is what a reader scans down. */}
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                {!rail && <Icon name={s.icon} size={14} className={cn("translate-y-[0.5px]", s.text)} />}
                <span className="text-[14px] font-semibold leading-[1.35] text-[color:var(--c-text)]">{f.title}</span>
                {f.provenance?.carried && (
                    <span className="rounded-full bg-[color:var(--c-surface-2)] px-1.5 py-[1px] text-[9.5px] font-semibold uppercase tracking-[0.05em] text-[color:var(--c-text-dim)]">
                        carried
                    </span>
                )}
            </div>

            {/* Everything below is INDENTED under the title, so the finding reads
                as one block with a head rather than four stacked lines. */}
            <div className={cn("mt-1", !rail && "pl-[22px]")}>
                {/* Level 2 — where. Dim, small, and on its own line rather than
                    fighting the title for the right edge. */}
                <code
                    className="font-mono text-[10.5px] text-[color:var(--c-text-dim)]"
                    title={f.file ?? undefined}
                >
                    {short(f.file, f.line)}
                </code>

                {/* Level 3 — why. The only prose, at reading measure. */}
                {f.detail && (
                    <p className="mt-1 max-w-[68ch] text-[12.5px] leading-[1.65] text-[color:var(--c-text-muted)]">{f.detail}</p>
                )}

                {/* Level 4 — what was checked. A citation list, so the NOTE is the
                    readable part and the location is the reference beside it. The
                    other way round put a 60-character path in front of the four
                    words that say why it matters. */}
                {f.evidence?.length ? (
                    <ul className="mt-2 flex flex-col gap-[3px] border-l border-[color:var(--c-border)] pl-2.5">
                        {f.evidence.map((e, i) => (
                            <li key={i} className="flex flex-wrap items-baseline gap-x-1.5 text-[11px] leading-[1.5]">
                                <span className="text-[color:var(--c-text-muted)]">{e.note ?? e.kind}</span>
                                <code className="font-mono text-[10px] text-[color:var(--c-text-dim)]" title={e.file}>
                                    {short(e.file, e.line)}
                                </code>
                            </li>
                        ))}
                    </ul>
                ) : null}
            </div>
        </div>
    )
}

/** Metadata, as a quiet rail rather than as five more drawers. */
export function MetaRail({ r, extra }: { r: PrAnalysis; extra?: React.ReactNode }) {
    return (
        <aside className="flex flex-col divide-y divide-[color:var(--c-border)] text-[12px] [&>*]:py-4 [&>*:first-child]:pt-0 [&>*:last-child]:pb-0">
            <div>
                <RailHeading icon="target">Confidence</RailHeading>
                <Meters r={r} />
            </div>

            <div>
                <RailHeading icon="code">Files touched</RailHeading>
                <ul className="flex flex-col gap-1.5">
                    {(r.impact_files ?? []).map((f, i) => (
                        <li key={i} className="min-w-0">
                            <code className="block truncate font-mono text-[11px] text-[color:var(--c-text)]" title={f.file}>
                                {f.file}
                            </code>
                            <span className="text-[11px] text-[color:var(--c-text-dim)]">{f.reason}</span>
                        </li>
                    ))}
                </ul>
            </div>

            {extra}

            <div>
                <RailHeading icon="nodes">Checked</RailHeading>
                <p className="leading-[1.7] text-[color:var(--c-text-muted)]">
                    {r.checks?.callers} callers · {r.checks?.precedents} precedents · {r.checks?.tests} test ·{" "}
                    {r.checks?.failure_probes} failure probe
                </p>
                <p className="mt-1 font-mono text-[10.5px] text-[color:var(--c-text-dim)]">build {r.analyser_build}</p>
            </div>
        </aside>
    )
}

/** Everything that is reference rather than review, behind ONE disclosure. */
export function MoreDetail({ r }: { r: PrAnalysis }) {
    return (
        <details className="group rounded-[12px] border border-[color:var(--c-border)]">
            <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 text-[12px] font-semibold text-[color:var(--c-text-muted)] [&::-webkit-details-marker]:hidden">
                <span className="transition-transform group-open:rotate-90">›</span>
                Impact, claims and checklist
            </summary>
            <div className="flex flex-col gap-4 border-t border-[color:var(--c-border)] px-4 py-4 text-[12.5px]">
                <div>
                    <h4 className="mb-1.5 text-[10.5px] font-bold uppercase tracking-[0.06em] text-[color:var(--c-text-dim)]">Impact</h4>
                    <ul className="flex list-disc flex-col gap-1 pl-4 leading-[1.65] text-[color:var(--c-text-muted)]">
                        {(r.impact ?? "").split("\n").filter(Boolean).map((l, i) => <li key={i}>{l.replace(/^-\s*/, "")}</li>)}
                    </ul>
                </div>
                <div>
                    <h4 className="mb-1.5 text-[10.5px] font-bold uppercase tracking-[0.06em] text-[color:var(--c-text-dim)]">Fix claims</h4>
                    {(r.fix_claims ?? []).map((c, i) => (
                        <p key={i} className="leading-[1.65] text-[color:var(--c-text-muted)]">
                            <span className="text-[color:var(--c-text)]">{c.claim}</span> — {c.reason}{" "}
                            <span className="rounded-full bg-[color:var(--c-success-bg)] px-1.5 py-[1px] text-[10.5px] font-semibold text-[color:var(--c-success)]">{c.verdict}</span>
                        </p>
                    ))}
                </div>
                <div>
                    <h4 className="mb-1.5 text-[10.5px] font-bold uppercase tracking-[0.06em] text-[color:var(--c-text-dim)]">Before merging</h4>
                    <ul className="flex list-disc flex-col gap-1 pl-4 leading-[1.65] text-[color:var(--c-text-muted)]">
                        {(r.checklist ?? []).map((c, i) => <li key={i}>{c}</li>)}
                    </ul>
                </div>
            </div>
        </details>
    )
}

/** The round strip. Every round is always on screen — no horizontal scroll.
 *
 *  A scroller hides rounds behind a gesture, and the question this strip exists
 *  to answer — how did this pull request get here — cannot be answered by a slice
 *  of it. So the row divides the width it has.
 *
 *  A closed round is a SLIVER, not a small card. Twenty-two pixels holds a dot
 *  and a number and nothing else, and that is the honest amount of information
 *  for something you are not currently reading: which round, and how it went.
 *  Anything more at that width is a clipped word pretending to be a word.
 *
 *  Two rounds open when the row can afford it, because the useful comparison is
 *  almost always "this one against the current one" — click round 2 and the
 *  current round stays open beside it. When the row cannot afford two readable
 *  cards it opens one, which is better than two unreadable ones.
 */
const SLIVER_W = 22
/** Below this a sliver shows its dot alone rather than half a digit. */
const SLIVER_NUM_W = 18
/** The floor — a dot plus its ring. */
const SLIVER_MIN = 8
const READABLE_W = 232
const STRIP_GAP = 6

export function Rounds() {
    const rounds = [
        { sha: "a3f1c02", n: 1, verdict: "Changes requested", blockers: 2, fixed: 0, carried: 0, msg: "feat(console): saved views", tone: "critical" as Sev },
        { sha: "1d90b4e", n: 2, verdict: "Changes requested", blockers: 1, fixed: 1, carried: 2, msg: "fix(console): guard the empty name", tone: "critical" as Sev },
        { sha: "c72aa10", n: 3, verdict: "Comment", blockers: 0, fixed: 1, carried: 1, msg: "test(console): cover the rename path", tone: "review" as Sev },
        { sha: "8e4b1f9", n: 4, verdict: "Comment", blockers: 0, fixed: 0, carried: 1, msg: "docs(console): say what a saved view is", tone: "review" as Sev },
        { sha: "7bd9e14", n: 5, verdict: "Changes requested", blockers: 1, fixed: 1, carried: 1, msg: "fix(console): validate the saved-view name", tone: "critical" as Sev },
    ]
    const last = rounds.length - 1
    const [sel, setSel] = useState(last)
    const [width, setWidth] = useState(0)
    const rowRef = useRef<HTMLDivElement | null>(null)

    // Measured, not guessed at from a breakpoint: the strip sits in a column
    // whose width depends on whether the metadata rail is showing, so a media
    // query would be answering about the wrong element.
    // Before paint, because every width below is derived from this number.
    useLayoutEffect(() => {
        const el = rowRef.current
        if (!el) return
        setWidth(el.getBoundingClientRect().width)
        if (typeof ResizeObserver === "undefined") return
        const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width))
        ro.observe(el)
        return () => ro.disconnect()
    }, [])

    // ONE card open — the selected one. Every round stays on screen, so the
    // strip cannot also afford a second readable card.
    const open = new Set<number>([sel])

    // Grow weights over a zero basis, summing to the free space: flex hands out
    // free space by weight, so the row lands on exactly these widths and cannot
    // overflow, however many rounds there are.
    const gaps = (rounds.length - 1) * STRIP_GAP
    const slivers = Math.max(1, rounds.length - 1)
    const free = Math.max(0, width - gaps)
    const sliverW = free > 0 ? Math.max(SLIVER_MIN, Math.min(SLIVER_W, (free - READABLE_W) / slivers)) : SLIVER_W
    const openW = free > 0 ? Math.max(0, free - slivers * sliverW) : READABLE_W
    const showNumber = sliverW >= SLIVER_NUM_W

    return (
        <div ref={rowRef} className="flex min-h-[78px] w-full" style={{ gap: STRIP_GAP }}>
            {/* Nothing until measured — the widths come from that measurement. */}
            {width > 0 && rounds.map((r, i) => {
                const isOpen = open.has(i)
                const current = i === last
                return (
                    <button
                        key={r.sha}
                        type="button"
                        onClick={() => setSel(i)}
                        aria-expanded={isOpen}
                        aria-label={`Round ${r.n} — ${r.verdict}`}
                        style={{ flexGrow: isOpen ? openW : sliverW, flexBasis: 0, minWidth: 0 }}
                        className={cn(
                            "flex min-w-0 flex-col overflow-hidden rounded-[10px] border text-left",
                            "transition-[flex-grow,background-color,border-color,opacity] duration-300 ease-out",
                            isOpen
                                ? "items-stretch justify-start px-2.5 py-2 bg-[color:var(--c-surface-2)]"
                                : "items-center justify-center gap-1 px-0 py-2 border-[color:var(--c-border)] opacity-70 hover:opacity-100",
                            // The one you clicked, in the app's own selection
                            // colour. A closed sliver keeps a hairline of it so
                            // a selection that squeezed is still findable.
                            i === sel
                                ? "border-[color:var(--c-primary)] ring-1 ring-inset ring-[color:var(--c-primary)]/40"
                                : isOpen
                                  ? "border-[color:var(--c-border-strong)]"
                                  : "",
                        )}
                    >
                        {isOpen ? (
                            <>
                                <div className="flex items-center gap-1.5">
                                    <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", SEV[r.tone].dot)} />
                                    <span className="shrink-0 text-[11px] font-semibold text-[color:var(--c-text-muted)]">{r.n}</span>
                                    <code className="truncate font-mono text-[11px] text-[color:var(--c-text-dim)]">{r.sha}</code>
                                    {current && (
                                        <span className="ml-auto shrink-0 text-[9.5px] font-bold uppercase tracking-[0.06em] text-[color:var(--c-text-dim)]">
                                            current
                                        </span>
                                    )}
                                </div>
                                <div className="mt-1 flex min-w-0 items-center gap-1.5">
                                    <span className="truncate text-[12px] font-semibold text-[color:var(--c-text)]">{r.verdict}</span>
                                    {r.fixed > 0 && (
                                        <span className="shrink-0 whitespace-nowrap rounded-full bg-[color:var(--c-success-bg)] px-1.5 py-[1px] text-[10px] font-semibold text-[color:var(--c-success)]">
                                            {r.fixed} fixed
                                        </span>
                                    )}
                                    {r.blockers > 0 && (
                                        <span className="shrink-0 whitespace-nowrap rounded-full bg-[color:var(--c-error-bg)] px-1.5 py-[1px] text-[10px] font-semibold text-[color:var(--c-error)]">
                                            {r.blockers} blocker{r.blockers === 1 ? "" : "s"}
                                        </span>
                                    )}
                                    {r.carried > 0 && (
                                        <span className="shrink-0 whitespace-nowrap rounded-full bg-[color:var(--c-surface-2)] px-1.5 py-[1px] text-[10px] font-medium text-[color:var(--c-text-muted)]">
                                            {r.carried} carried
                                        </span>
                                    )}
                                </div>
                                <p className="mt-1 truncate text-[11px] text-[color:var(--c-text-dim)]">{r.msg}</p>
                            </>
                        ) : (
                            // A sliver says which round and how it went. Nothing else
                            // fits, and a clipped word is worse than no word.
                            <>
                                <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", SEV[r.tone].dot)} />
                                {showNumber && (
                                    <span className="text-[10.5px] font-semibold tabular-nums text-[color:var(--c-text-muted)]">{r.n}</span>
                                )}
                            </>
                        )}
                    </button>
                )
            })}
        </div>
    )
}

/** The footer: diligence, attribution and the one action, on one line each. */
export function Footer({ r }: { r: PrAnalysis }) {
    const lenses = ["correctness & bugs", "blast radius", "test gaps", "conventions", "layering drift", "history & regressions", "security", "api contract"]
    return (
        <div className="mt-5 flex flex-col gap-3 border-t border-[color:var(--c-border)] pt-4">
            <p className="text-[11px] leading-[1.7] text-[color:var(--c-text-dim)]">
                <span className="text-[color:var(--c-text-muted)]">Lenses</span> {lenses.join(" · ")}
            </p>
            <div className="flex flex-wrap items-center gap-3">
                <button
                    type="button"
                    className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--c-border)] px-3.5 py-1.5 text-[12px] font-medium text-[color:var(--c-text)] transition-colors hover:border-[color:var(--c-border-strong)] hover:bg-[color:var(--c-surface-2)]"
                >
                    Deep dive with Ucelot
                </button>
                <span className="ml-auto text-[11px] text-[color:var(--c-text-dim)]">
                    Reviewed in {((r.duration_ms ?? 0) / 1000).toFixed(1)}s · build {r.analyser_build}
                </span>
            </div>
            <p className="text-[10.5px] text-[color:var(--c-text-dim)]">Ucelot is AI-assisted and can make mistakes — verify findings before acting.</p>
        </div>
    )
}

/** The merge-readiness bar — the SAME segmented visual the GitHub comment
 *  renders as an SVG (lib/shared/rendering/badge.ts scoreImage).
 *
 *  The first draft of this proposal replaced it with the text "4 / 10 ready",
 *  which is tidier and wrong: a reader who saw the bar on GitHub arrives here
 *  and finds a different thing. Two surfaces, one review, one visual. */
export function ScoreBar({ value, max }: { value: number; max: number }) {
    const r = max > 0 ? value / max : 0
    const band =
        r >= 0.8
            ? { text: "text-[color:var(--c-success)]", fill: "bg-[color:var(--c-success)]", empty: "bg-[color:var(--c-success)]/20" }
            : r >= 0.5
              ? { text: "text-[color:var(--c-warn)]", fill: "bg-[color:var(--c-warn)]", empty: "bg-[color:var(--c-warn)]/20" }
              : { text: "text-[color:var(--c-error)]", fill: "bg-[color:var(--c-error)]", empty: "bg-[color:var(--c-error)]/20" }
    return (
        <div className="mt-3 flex items-center gap-2.5">
            <span className={cn("flex items-baseline gap-1", band.text)}>
                <span className="text-[20px] font-bold leading-none">{value}</span>
                <span className="text-[11px] opacity-70">/ {max}</span>
            </span>
            <div className="flex flex-1 items-center gap-[3px]">
                {Array.from({ length: max }).map((_, i) => (
                    <span key={i} className={cn("h-2 flex-1 rounded-[2px]", i < value ? band.fill : band.empty)} />
                ))}
            </div>
            <span className={cn("shrink-0 text-[10px] font-bold uppercase tracking-[0.06em] opacity-70", band.text)}>readiness</span>
        </div>
    )
}

/** Confidence, as the three-segment meters the comment also draws — not as a
 *  word. Same reason as ScoreBar: the two surfaces must agree. */
export function Meters({ r }: { r: PrAnalysis }) {
    const rows = [
        ["correctness", r.confidences?.correctness],
        ["load / perf", r.confidences?.load_perf],
        ["security", r.confidences?.security],
    ] as const
    return (
        <div className="flex flex-col gap-2">
            {rows.map(([label, d]) => {
                if (!d) return null
                const idx = d.level === "high" ? 3 : d.level === "medium" ? 2 : 1
                const tone =
                    d.level === "high"
                        ? { fill: "bg-[color:var(--c-success)]", text: "text-[color:var(--c-success)]" }
                        : d.level === "medium"
                          ? { fill: "bg-[color:var(--c-warn)]", text: "text-[color:var(--c-warn)]" }
                          : { fill: "bg-[color:var(--c-error)]", text: "text-[color:var(--c-error)]" }
                return (
                    <div key={label} className="flex items-center gap-2" title={d.basis}>
                        <span className="w-[72px] shrink-0 text-[11px] text-[color:var(--c-text-muted)]">{label}</span>
                        <div className="flex items-center gap-[3px]">
                            {[0, 1, 2].map((i) => (
                                <span key={i} className={cn("h-2 w-3 rounded-[2px]", i < idx ? tone.fill : "bg-[color:var(--c-surface-2)]")} />
                            ))}
                        </div>
                        <span className={cn("text-[11px] font-semibold", tone.text)}>{d.level}</span>
                    </div>
                )
            })}
        </div>
    )
}

/** A rail heading: glyph, then label. The glyph is what makes the rail
 *  scannable at a glance — three identical uppercase words are not. */
export function RailHeading({ icon, children }: { icon: IconName; children: React.ReactNode }) {
    return (
        <h4 className="mb-2 flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-[0.06em] text-[color:var(--c-text-dim)]">
            <Icon name={icon} size={12} />
            {children}
        </h4>
    )
}

/** In flight — queued or running. The standing round stays on the page, because
 *  it is what the merge gate is still reading. */
export function InFlight({ queued }: { queued?: boolean }) {
    return (
        <div className="flex flex-col gap-1 rounded-[12px] border border-[color:var(--c-warn)]/30 bg-[color:var(--c-warn-bg)] px-4 py-3 text-[color:var(--c-warn)]">
            <span className="flex items-center gap-2 text-[13px] font-semibold">
                <span className={cn("h-2 w-2 rounded-full bg-[color:var(--c-warn)]", !queued && "animate-pulse")} />
                {queued ? "Queued — waiting for a review slot" : "Reviewing 1 new commit"}
            </span>
            <span className="text-[12px] opacity-85">
                The round below still stands until this finishes — it is what the merge gate is reading.
            </span>
        </div>
    )
}

/** Viewing an earlier round. Says so plainly, because a stale review presented
 *  as current is the worst thing this panel can do. */
export function ArchiveBanner({ round }: { round: number }) {
    return (
        <div className="flex flex-wrap items-center gap-2 rounded-[12px] border border-[color:var(--c-border-strong)] bg-[color:var(--c-surface-2)] px-4 py-2.5 text-[12px]">
            <Icon name="chat" size={13} className="text-[color:var(--c-text-muted)]" />
            <span className="font-semibold text-[color:var(--c-text)]">Viewing round {round}</span>
            <span className="text-[color:var(--c-text-muted)]">— the review as it stood then. Some of it may since have been fixed.</span>
            <button type="button" className="ml-auto rounded-full border border-[color:var(--c-border)] px-2.5 py-[3px] text-[11.5px] font-medium hover:bg-[color:var(--c-surface)]">
                Back to current
            </button>
        </div>
    )
}

/** Degraded — the grounded pass did not land, so this is reduce's draft. Never
 *  silent: an unfinished review that looks finished is how a blocker gets missed. */
export function DegradedNote() {
    return (
        <div className="flex items-start gap-2 rounded-[12px] border border-[color:var(--c-warn)]/30 bg-[color:var(--c-warn-bg)] px-4 py-3 text-[12px] leading-[1.6] text-[color:var(--c-warn)]">
            <Icon name="alert" size={14} className="mt-[2px]" />
            <span>
                <b>Partial review.</b> The grounded pass did not complete, so this is the diff-level draft — read it as
                unfinished rather than as a clean bill of health.
            </span>
        </div>
    )
}

/** A terminal state that produced nothing. */
export function EmptyState({ kind }: { kind: "failed" | "cancelled" | "none" }) {
    const copy = {
        failed: { icon: "x" as IconName, text: "Ucelot couldn't complete the review this time.", tone: "text-[color:var(--c-error)] border-[color:var(--c-error)]/30 bg-[color:var(--c-error-bg)]" },
        cancelled: { icon: "x" as IconName, text: "The review was cancelled — the pull request closed before it finished.", tone: "text-[color:var(--c-text-muted)] border-[color:var(--c-border)]" },
        none: { icon: "chat" as IconName, text: "No review yet for this pull request.", tone: "text-[color:var(--c-text-muted)] border-[color:var(--c-border)]" },
    }[kind]
    return (
        <div className={cn("flex items-center gap-2 rounded-[12px] border px-4 py-3 text-[12.5px]", copy.tone)}>
            <Icon name={copy.icon} size={14} />
            {copy.text}
        </div>
    )
}

/** What this round changed relative to the last one. */
export function ProgressLine({ fixed, added }: { fixed: number; added: number }) {
    return (
        <p className="flex flex-wrap items-center gap-2 text-[12px] text-[color:var(--c-text-muted)]">
            {fixed > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-[color:var(--c-success-bg)] px-2 py-[2px] font-semibold text-[color:var(--c-success)]">
                    <Icon name="check" size={11} /> {fixed} fixed
                </span>
            )}
            since the last push
            {added > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-[color:var(--c-warn-bg)] px-2 py-[2px] font-semibold text-[color:var(--c-warn)]">
                    {added} new
                </span>
            )}
        </p>
    )
}

/** How a finding group announces itself.
 *
 *  The headings are the panel's spine — they are what makes triage possible
 *  without reading — and they were the dimmest thing on the page: small, grey,
 *  uppercase, indistinguishable from each other except by four words. Four ways
 *  to fix that, because the right amount of emphasis is a judgement.
 */
export type HeadStyle = "quiet" | "toned" | "rule" | "rail" | "band"

export function GroupHead({
    sev,
    title,
    count,
    style,
}: {
    sev: Sev
    title: string
    count: number
    style: HeadStyle
}) {
    const s = SEV[sev]
    // No glyph. At this size the WORD is the marker — an icon beside it competes
    // with the per-finding glyphs directly below, and two of the same symbol a
    // few pixels apart reads as noise rather than as a hierarchy.
    const label = (
        <>
            <span>{title}</span>
            <span
                className={cn(
                    "rounded-full px-1.5 py-[1px] text-[11px] font-bold normal-case tracking-normal tabular-nums",
                    style === "quiet" || style === "rule"
                        ? "bg-[color:var(--c-surface-2)] text-[color:var(--c-text-muted)]"
                        : "bg-[color:var(--c-surface)]/70",
                )}
            >
                {count}
            </span>
        </>
    )

    const base = "flex items-center gap-2 text-[13.5px] font-bold uppercase tracking-[0.05em]"

    if (style === "quiet") {
        return <h3 className={cn(base, "mb-2.5 text-[color:var(--c-text-muted)]")}>{label}</h3>
    }
    // Toned: the label takes its severity's colour instead of grey. One line of
    // change, and the heading stops being furniture.
    if (style === "toned") {
        return <h3 className={cn(base, "mb-2.5", s.text)}>{label}</h3>
    }
    // Rule: the same, with a hairline running to the edge — the heading reads as
    // a section BREAK rather than as the first line of the group.
    if (style === "rule") {
        return (
            <h3 className={cn(base, "mb-3", s.text)}>
                {label}
                <span className="ml-1 h-px flex-1 bg-[color:var(--c-border)]" />
            </h3>
        )
    }
    // Band: a tinted row. Loudest, and the one that risks bringing the boxes back.
    if (style === "band") {
        return (
            <h3 className={cn(base, "mb-3 rounded-[8px] px-3 py-2", s.chip)}>{label}</h3>
        )
    }
    // Rail handles its own heading inside GroupRail below.
    return <h3 className={cn(base, "mb-2", s.text)}>{label}</h3>
}

/** The "rail" treatment: a coloured bar down the whole group, so the findings
 *  are visibly bound to the heading that owns them and severity is legible from
 *  the edge of the column without reading a word. */
export function GroupRail({ sev, children, on }: { sev: Sev; children: React.ReactNode; on: boolean }) {
    if (!on) return <>{children}</>
    return (
        <div className={cn("border-l-2 pl-3.5", SEV[sev].rail)}>{children}</div>
    )
}
