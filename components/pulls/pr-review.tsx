"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import rehypeHighlight from "rehype-highlight"
import { cn } from "@/components/ui/cn"
import { severityLabel } from "@/lib/shared/rendering/badge"
import { findingState } from "@/lib/shared/rendering/finding-state"
import { apiMutate } from "@/lib/client/http/api-client"
import type { PrAnalysis, PrChecks, PrConfidenceDimension, PrConfidences, PrFinding, PullRequestAnalysis } from "@/lib/shared/types"

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
            return "bg-zinc-100 text-zinc-600"
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

function Shell({ children }: { children: React.ReactNode }) {
    return (
        <section className="rounded-[16px] border border-[color:var(--c-border)] bg-white p-4 shadow-[var(--shadow-card)] sm:p-5">
            <div className="mb-3 flex items-center gap-2">
                <span className="grid h-6 w-6 place-items-center rounded-[7px] bg-amber-50 text-amber-600">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <circle cx="11" cy="11" r="7" />
                        <path d="M21 21l-4.3-4.3" />
                    </svg>
                </span>
                <h2 className="text-[14px] font-bold tracking-[-0.005em]">Ucelot · PR review</h2>
            </div>
            {children}
        </section>
    )
}

function Placeholder({ tone, text }: { tone: "muted" | "amber" | "rose"; text: string }) {
    const cls =
        tone === "amber"
            ? "border-amber-200 bg-amber-50 text-amber-900"
            : tone === "rose"
              ? "border-rose-200 bg-rose-50 text-rose-800"
              : "border-dashed border-[color:var(--c-border)] bg-white text-[color:var(--c-text-muted)]"
    return <div className={cn("rounded-[12px] border px-4 py-6 text-center text-[13px]", cls)}>{text}</div>
}

export function PrReview({ analysis }: { analysis: PullRequestAnalysis | null }) {
    const status = analysis?.status ?? null
    const result = analysis?.result ?? null

    if (status === "analysing") {
        return (
            <Shell>
                <Placeholder tone="amber" text="Ucelot is reviewing this pull request… this panel fills in automatically." />
            </Shell>
        )
    }
    if (status === "failed") {
        return (
            <Shell>
                <Placeholder tone="rose" text="Ucelot couldn't complete the review this time." />
            </Shell>
        )
    }
    if (status === "cancelled") {
        return (
            <Shell>
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
        <Shell>
            <Review r={result} projectId={analysis?.project_id ?? null} />
        </Shell>
    )
}

// Finding groups by traffic-light state, issues first. Each becomes a
// collapsible section so a long review stays scannable.
const GROUPS: { key: "critical" | "review" | "good"; title: string; tone: string; open: boolean }[] = [
    { key: "critical", title: "Blockers", tone: "bg-rose-100 text-rose-700", open: true },
    { key: "review", title: "Worth a review", tone: "bg-amber-100 text-amber-700", open: true },
    { key: "good", title: "Looks good", tone: "bg-emerald-100 text-emerald-700", open: false },
]

function Review({ r, projectId }: { r: PrAnalysis; projectId: string | null }) {
    const findings = r.findings ?? []
    const grouped = GROUPS.map((g) => ({ ...g, items: findings.filter((f) => findingState(f.severity) === g.key) }))
    const counts = Object.fromEntries(grouped.map((g) => [g.key, g.items.length]))

    return (
        <div className="flex flex-col gap-3">
            {r.verdict && (
                <div className={cn("flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[10px] border px-3 py-2", verdictBannerClasses(r.verdict))}>
                    <span className="inline-flex items-center gap-1.5 text-[13px] font-bold">
                        <VerdictIcon v={r.verdict} />
                        {verdictLabel(r.verdict)}
                    </span>
                    {r.verdict_reason && <span className="text-[12.5px] leading-5 opacity-90">— {r.verdict_reason}</span>}
                </div>
            )}

            {/* Merge-readiness headline: the analyser's score + bar, or a plain
                "not ready" placeholder when it didn't send one (never faked). */}
            {typeof r.score === "number" && r.score_max ? (
                <ScoreBar value={r.score} max={r.score_max} />
            ) : (
                <div className="flex items-center gap-2 rounded-[12px] border border-dashed border-[color:var(--c-border)] bg-white px-3.5 py-2.5">
                    <span className="text-[12.5px] font-semibold text-[color:var(--c-text)]">Merge readiness</span>
                    <span className="text-[12px] text-[color:var(--c-text-muted)]">· not ready</span>
                </div>
            )}

            {/* Finding tally, so the reader orients before scrolling. */}
            {(counts.critical > 0 || counts.review > 0 || counts.good > 0) && (
                <div className="flex flex-wrap items-center gap-1.5">
                    {counts.critical > 0 && <Tally n={counts.critical} label="blocker" tone="bg-rose-100 text-rose-700" />}
                    {counts.review > 0 && <Tally n={counts.review} label="to review" tone="bg-amber-100 text-amber-700" />}
                    {counts.good > 0 && <Tally n={counts.good} label="good" tone="bg-emerald-100 text-emerald-700" />}
                </div>
            )}

            {/* Per-dimension confidence as 3-stage meters, coloured by level. */}
            {r.confidences ? (
                <ConfidenceMeters c={r.confidences} />
            ) : (
                r.confidence && (
                    <span className={cn("inline-flex w-fit items-center rounded-full px-2 py-[2px] text-[11px] font-semibold", confidenceClasses(r.confidence))}>
                        confidence: {r.confidence}
                    </span>
                )
            )}

            {r.summary?.trim() && (
                <blockquote className="border-l-2 border-amber-300 pl-3 text-[13.5px] leading-6 text-[color:var(--c-text)]">
                    <Md>{r.summary}</Md>
                </blockquote>
            )}

            {(r.impact?.trim() || (r.impact_files && r.impact_files.length > 0)) && (
                <Section title="Impact">
                    {r.impact?.trim() && <Md className="text-[13px] leading-6">{r.impact}</Md>}
                    {r.impact_files && r.impact_files.length > 0 && (
                        <ul className="mt-1.5 flex flex-col gap-1.5">
                            {r.impact_files.map((f, i) => (
                                <li key={i} className="text-[12.5px] leading-5">
                                    <code className="rounded bg-[color:var(--c-surface-2)] px-1 py-[1px] font-mono text-[11.5px]">{f.file}</code>
                                    <span className="text-[color:var(--c-text-muted)]"> — {f.reason}</span>
                                </li>
                            ))}
                        </ul>
                    )}
                </Section>
            )}

            {grouped.map((g) =>
                g.items.length === 0 ? null : (
                    <Section key={g.key} title={g.title} count={g.items.length} countTone={g.tone} defaultOpen={g.open}>
                        <div className="flex flex-col gap-2">
                            {g.items.map((f, i) => (
                                <Finding key={i} f={f} />
                            ))}
                        </div>
                    </Section>
                ),
            )}

            {r.fix_claims && r.fix_claims.length > 0 && (
                <Section title="Fix claims" count={r.fix_claims.length}>
                    <div className="flex flex-col gap-2">
                        {r.fix_claims.map((c, i) => (
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
            )}

            {r.checklist && r.checklist.length > 0 && (
                <Section title="Nice to check" count={r.checklist.length} defaultOpen={false}>
                    <ul className="flex flex-col gap-1.5">
                        {r.checklist.map((c, i) => (
                            <li key={i} className="flex items-start gap-2 text-[12.5px] leading-5 text-[color:var(--c-text-muted)]">
                                <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-[color:var(--c-text-dim)]" aria-hidden />
                                <span>{c}</span>
                            </li>
                        ))}
                    </ul>
                </Section>
            )}

            {r.checks && <ChecksFooter checks={r.checks} />}

            {(r.duration_ms != null || (r.insight_id && projectId)) && (
                <div className="flex items-center justify-between gap-3 pt-1">
                    {r.insight_id && projectId ? <DeepDiveButton insightId={r.insight_id} projectId={projectId} /> : <span />}
                    {r.duration_ms != null && (
                        <p className="text-[11px] text-[color:var(--c-text-dim)]">Reviewed in {(r.duration_ms / 1000).toFixed(1)}s</p>
                    )}
                </div>
            )}

            {/* AI disclaimer — subtle, like the platforms' "can make mistakes" note. */}
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
        <details open={defaultOpen} className="group rounded-[12px] border border-[color:var(--c-border)] bg-white">
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
function meterTone(level: string): { fill: string; text: string } {
    return level === "high"
        ? { fill: "bg-emerald-500", text: "text-emerald-600" }
        : level === "medium"
          ? { fill: "bg-amber-500", text: "text-amber-600" }
          : { fill: "bg-rose-500", text: "text-rose-600" }
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
function ConfidenceMeters({ c }: { c: PrConfidences }) {
    return (
        <div className="flex flex-col gap-1.5">
            <Meter label="correctness" dim={c.correctness} />
            <Meter label="load / perf" dim={c.load_perf} />
            <Meter label="security" dim={c.security} />
        </div>
    )
}

// The KB-verification tally (ADR-0057) — the diligence behind the review,
// rendered as a terse "Checked N callers · M precedents · …" line. Zero counts
// are omitted; nothing to show → nothing rendered.
function ChecksFooter({ checks }: { checks: PrChecks }) {
    const parts: string[] = []
    if (checks.callers) parts.push(`${checks.callers} caller${checks.callers === 1 ? "" : "s"}`)
    if (checks.precedents) parts.push(`${checks.precedents} precedent${checks.precedents === 1 ? "" : "s"}`)
    if (checks.tests) parts.push(`${checks.tests} test${checks.tests === 1 ? "" : "s"}`)
    if (checks.failure_probes) parts.push(`${checks.failure_probes} failure probe${checks.failure_probes === 1 ? "" : "s"}`)
    if (checks.git_reads) parts.push(`${checks.git_reads} history read${checks.git_reads === 1 ? "" : "s"}`)
    if (parts.length === 0 && !checks.dropped) return null
    return (
        <p className="border-t border-[color:var(--c-border)] pt-2 text-[11px] text-[color:var(--c-text-dim)]">
            {parts.length > 0 && <>Checked {parts.join(" · ")}</>}
            {checks.dropped ? <span className="text-[color:var(--c-text-muted)]">{parts.length > 0 ? " · " : ""}{checks.dropped} ungrounded dropped</span> : null}
        </p>
    )
}

// A rich finding card: severity + category + title + location on top, then the
// detail, a collapsible syntax-highlighted diff of the changed code, the cited
// evidence, and what the reviewer verified.
function Finding({ f }: { f: PrFinding }) {
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
                className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--c-border)] bg-white px-3 py-1 text-[12px] font-medium text-[color:var(--c-text)] transition-colors hover:border-[color:var(--c-border-strong)] hover:bg-[color:var(--c-surface-2)] disabled:opacity-50"
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
