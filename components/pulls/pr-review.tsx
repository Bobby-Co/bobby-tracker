"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { cn } from "@/components/ui/cn"
import { findingState, severityLabel } from "@/lib/badge"
import type { PRAnalysis, PRFinding, PullRequestAnalysis } from "@/lib/supabase/types"

// Renders Bobby's persisted PR review (pull_request_analyses.result) natively —
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
                <h2 className="text-[14px] font-bold tracking-[-0.005em]">Bobby · PR review</h2>
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
                <Placeholder tone="amber" text="Bobby is reviewing this pull request… this panel fills in automatically." />
            </Shell>
        )
    }
    if (status === "failed") {
        return (
            <Shell>
                <Placeholder tone="rose" text="Bobby couldn't complete the review this time." />
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

function Review({ r, projectId }: { r: PRAnalysis; projectId: string | null }) {
    return (
        <div className="flex flex-col gap-4">
            {r.verdict && (
                <div className={cn("flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[10px] border px-3 py-2", verdictBannerClasses(r.verdict))}>
                    <span className="inline-flex items-center gap-1.5 text-[13px] font-bold">
                        <VerdictIcon v={r.verdict} />
                        {verdictLabel(r.verdict)}
                    </span>
                    {r.verdict_reason && <span className="text-[12.5px] leading-5 opacity-90">— {r.verdict_reason}</span>}
                </div>
            )}

            {r.confidence && (
                <div>
                    <span className={cn("inline-flex items-center rounded-full px-2 py-[2px] text-[11px] font-semibold", confidenceClasses(r.confidence))}>
                        confidence: {r.confidence}
                    </span>
                </div>
            )}

            {r.summary?.trim() && (
                <blockquote className="border-l-2 border-amber-300 pl-3 text-[13.5px] leading-6 text-[color:var(--c-text)]">
                    <div className="prose-tracker">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{r.summary}</ReactMarkdown>
                    </div>
                </blockquote>
            )}

            {r.impact?.trim() && (
                <div>
                    <h3 className="mb-1 text-[12px] font-bold uppercase tracking-[0.03em] text-[color:var(--c-text-muted)]">Impact</h3>
                    <div className="prose-tracker text-[13px] leading-6">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{r.impact}</ReactMarkdown>
                    </div>
                </div>
            )}

            {r.impact_files && r.impact_files.length > 0 && (
                <div>
                    <h3 className="mb-1.5 text-[12px] font-bold uppercase tracking-[0.03em] text-[color:var(--c-text-muted)]">Affected files</h3>
                    <ul className="flex flex-col gap-1.5">
                        {r.impact_files.map((f, i) => (
                            <li key={i} className="text-[12.5px] leading-5">
                                <code className="rounded bg-[color:var(--c-surface-2)] px-1 py-[1px] font-mono text-[11.5px]">{f.file}</code>
                                <span className="text-[color:var(--c-text-muted)]"> — {f.reason}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {r.findings && r.findings.length > 0 && (
                <div>
                    <h3 className="mb-1.5 text-[12px] font-bold uppercase tracking-[0.03em] text-[color:var(--c-text-muted)]">Review</h3>
                    <div className="flex flex-col gap-2">
                        {r.findings.map((f, i) => (
                            <Finding key={i} f={f} />
                        ))}
                    </div>
                </div>
            )}

            {r.fix_claims && r.fix_claims.length > 0 && (
                <div>
                    <h3 className="mb-1.5 text-[12px] font-bold uppercase tracking-[0.03em] text-[color:var(--c-text-muted)]">Fix claims</h3>
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
                </div>
            )}

            {r.concerns && r.concerns.length > 0 && (
                <div>
                    <h3 className="mb-1.5 text-[12px] font-bold uppercase tracking-[0.03em] text-[color:var(--c-text-muted)]">Concerns</h3>
                    <ul className="flex list-disc flex-col gap-1 pl-4 text-[12.5px] leading-5 text-[color:var(--c-text)]">
                        {r.concerns.map((c, i) => (
                            <li key={i}>{c}</li>
                        ))}
                    </ul>
                </div>
            )}

            {r.checklist && r.checklist.length > 0 && (
                <div>
                    <h3 className="mb-1.5 text-[12px] font-bold uppercase tracking-[0.03em] text-[color:var(--c-text-muted)]">Nice to check</h3>
                    <ul className="flex flex-col gap-1.5">
                        {r.checklist.map((c, i) => (
                            <li key={i} className="flex items-start gap-2 text-[12.5px] leading-5 text-[color:var(--c-text-muted)]">
                                <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-[color:var(--c-text-dim)]" aria-hidden />
                                <span>{c}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {(r.duration_ms != null || (r.insight_id && projectId)) && (
                <div className="flex items-center justify-between gap-3 pt-1">
                    {r.insight_id && projectId ? <DeepDiveButton insightId={r.insight_id} projectId={projectId} /> : <span />}
                    {r.duration_ms != null && (
                        <p className="text-[11px] text-[color:var(--c-text-dim)]">Reviewed in {(r.duration_ms / 1000).toFixed(1)}s</p>
                    )}
                </div>
            )}
        </div>
    )
}

// One scannable line: severity chip · short title · file. The longer detail sits
// muted underneath, and only when it adds something over the title.
function Finding({ f }: { f: PRFinding }) {
    const loc = f.line && f.line > 0 ? `${f.file}:${f.line}` : f.file
    const title = (f.title && f.title.trim()) || f.detail
    const hasDetail = !!(f.title && f.title.trim() && f.detail && f.detail.trim() !== f.title.trim())
    return (
        <div className="rounded-[10px] border border-[color:var(--c-border)] bg-[color:var(--c-surface-2)] px-2.5 py-2">
            <div className="flex items-baseline gap-2">
                <span className={cn("shrink-0 rounded-full px-1.5 py-[1px] text-[10px] font-semibold uppercase tracking-wide", severityClasses(f.severity))}>
                    {severityLabel(f.severity)}
                </span>
                <span className="min-w-0 flex-1 text-[12.5px] font-medium leading-5 text-[color:var(--c-text)]">{title}</span>
                <code className="max-w-[42%] shrink-0 truncate font-mono text-[10.5px] text-[color:var(--c-text-muted)]" title={loc}>
                    {loc}
                </code>
            </div>
            {hasDetail && <p className="mt-1 text-[12px] leading-5 text-[color:var(--c-text-muted)]">{f.detail}</p>}
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
            const res = await fetch(`/api/projects/${projectId}/pr-insight/deep-dive`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ insight_id: insightId }),
            })
            if (!res.ok) throw new Error(String(res.status))
            const j = (await res.json()) as { conversation_id?: string; pr_number?: number; pr_title?: string }
            if (!j.conversation_id) throw new Error("no conversation")
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
                {busy ? "Opening…" : "Deep dive with Bobby"}
            </button>
            {err && <span className="text-[11px] text-rose-600">Couldn&apos;t open</span>}
        </div>
    )
}
