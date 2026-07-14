"use client"

import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { cn } from "@/components/ui/cn"
import type { PRAnalysis, PullRequestAnalysis } from "@/lib/supabase/types"

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
            <Review r={result} />
        </Shell>
    )
}

function Review({ r }: { r: PRAnalysis }) {
    return (
        <div className="flex flex-col gap-4">
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

            {r.duration_ms != null && (
                <p className="text-[11px] text-[color:var(--c-text-dim)]">Reviewed in {(r.duration_ms / 1000).toFixed(1)}s</p>
            )}
        </div>
    )
}
