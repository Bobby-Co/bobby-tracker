"use client"

import Link from "next/link"
import { useEffect, useRef, useState, useTransition } from "react"
import type { IssueAnalysisData, IssueFinding, IssuePriority, IssueStatus, IssueSuggestion } from "@/lib/supabase/types"
import { Spinner } from "@/components/spinner"
import { reporterDisplay } from "@/lib/public-reporter"

interface PublicIssue {
    id: string
    issue_number: number
    title: string
    body: string
    status: IssueStatus
    priority: IssuePriority
    labels: string[]
    public_reporter_id: string | null
    public_reporter_name: string | null
    created_at: string
    updated_at: string
}

interface PublicAnalyser {
    ready: boolean
    status: string
    indexed_sha: string | null
}

// Detail view for a publicly-submitted issue. Shows the issue body
// and the analyser's inference output. Auto-fires the public /suggest
// endpoint on mount when the analyser is ready and no suggestion has
// been cached yet, then polls every 3s until the suggestion lands.
export function PublicIssueView({
    token,
    issue,
    initialSuggestion,
    analyser,
}: {
    token: string
    issue: PublicIssue
    initialSuggestion: IssueSuggestion | null
    analyser: PublicAnalyser
}) {
    const [suggestion, setSuggestion] = useState<IssueSuggestion | null>(initialSuggestion)
    const [error, setError] = useState<string | null>(null)
    const [errorCode, setErrorCode] = useState<string | null>(null)
    const [pending, startTransition] = useTransition()
    const autoFiredRef = useRef(false)

    // Public visitors can't *manually* regenerate analysis (it would
    // let any anonymous viewer churn analyser cost), but the issue
    // still needs an analysis to be useful — so we auto-fire ONCE
    // per mount when no suggestion is cached and the graph is ready.
    // The owner can manually regenerate later from the authenticated
    // tracker if they need a fresh run.
    function autoRunOnce() {
        setError(null)
        setErrorCode(null)
        startTransition(async () => {
            const res = await fetch(`/api/public-issues/${issue.id}/suggest`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ token }),
            })
            if (!res.ok) {
                const body = await res.json().catch(() => ({}))
                setError(body?.error?.message || `Failed (${res.status})`)
                setErrorCode(body?.error?.code || "unknown")
                return
            }
            const { suggestion: next } = await res.json()
            setSuggestion(next)
        })
    }

    useEffect(() => {
        if (autoFiredRef.current) return
        if (!analyser.ready) return
        if (suggestion) return
        autoFiredRef.current = true
        autoRunOnce()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [analyser.ready, suggestion?.id])

    // Polling fallback for the long-running suggest call. The auth
    // path uses Supabase realtime here; we don't grant anon realtime
    // on issue_suggestions, so plain HTTP polling is the simpler
    // contract. Bounded to `pending` so it stops the moment any path
    // delivers the row.
    useEffect(() => {
        if (!pending) return
        let cancelled = false
        const tick = async () => {
            try {
                const res = await fetch(
                    `/api/public-issues/${issue.id}?token=${encodeURIComponent(token)}`,
                    { cache: "no-store" },
                )
                if (!res.ok || cancelled) return
                const data = await res.json()
                if (data?.suggestion && !cancelled) setSuggestion(data.suggestion)
            } catch {}
        }
        const id = setInterval(tick, 3000)
        return () => { cancelled = true; clearInterval(id) }
    }, [pending, issue.id, token])

    // Strip the "> Submitted via public link by …" stamp prefix when
    // displaying — the metadata is already shown above the body, so
    // duplicating it adds noise.
    const displayBody = issue.body.replace(/^>\s*Submitted via public link[^\n]*\n+/i, "")

    return (
        <div className="flex flex-col gap-5">
            <Link
                href={`/p/${token}`}
                className="self-start text-[11px] font-bold uppercase tracking-[0.12em] text-[color:var(--c-text-muted)] hover:text-[color:var(--c-text)]"
            >
                ← Back
            </Link>

            <article className="rounded-[14px] border border-[color:var(--c-border)] bg-white p-4 shadow-sm sm:p-6">
                <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-[color:var(--c-text-muted)]">
                    <span className="rounded-md bg-[color:var(--c-surface-2)] px-1.5 py-0.5 font-mono font-semibold text-[color:var(--c-text)]">
                        #{issue.issue_number}
                    </span>
                    <StatusPill status={issue.status} />
                    <PriorityPill priority={issue.priority} />
                    <span className="grow" />
                    <span>
                        Filed by{" "}
                        <span className="font-semibold text-[color:var(--c-text)]">
                            {reporterDisplay(issue.public_reporter_id, issue.public_reporter_name)}
                        </span>
                    </span>
                    <span aria-hidden>·</span>
                    <time dateTime={issue.created_at}>
                        {new Date(issue.created_at).toLocaleString()}
                    </time>
                </div>
                <h1 className="mt-2 text-[20px] font-bold leading-tight tracking-[-0.012em] sm:text-[24px]">
                    {issue.title}
                </h1>
                {displayBody.trim() && (
                    <pre className="mt-3 whitespace-pre-wrap break-words font-sans text-[13.5px] leading-relaxed text-[color:var(--c-text)]">
                        {displayBody}
                    </pre>
                )}
            </article>

            <section className="rounded-[14px] border border-[color:var(--c-border)] bg-white p-4 shadow-sm sm:p-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <h2 className="flex items-center gap-2 text-[14px] font-bold">
                            <SparklesIcon />
                            AI analysis
                        </h2>
                        <p className="mt-1 text-[12px] text-[color:var(--c-text-muted)]">
                            {pending
                                ? "Reading the codebase graph — typically 10–30s."
                                : suggestion
                                    ? <>Generated {timeAgo(suggestion.created_at)}{suggestion.cost_usd != null ? ` · $${Number(suggestion.cost_usd).toFixed(4)}` : ""}</>
                                    : "Citations into the project's source code (when the maintainer's graph is ready)."}
                        </p>
                    </div>
                    {pending && (
                        <span className="inline-flex items-center gap-1.5 text-[12px] text-[color:var(--c-text-muted)]">
                            <Spinner /> Investigating…
                        </span>
                    )}
                </div>

                {!analyser.ready && !suggestion && !pending && <NotIndexedNotice />}

                {error && errorCode !== "needs_indexing" && (
                    <p role="alert" className="mt-3 rounded-[10px] bg-rose-50 px-3 py-2 text-[12.5px] text-rose-800">
                        {error}
                    </p>
                )}
                {errorCode === "needs_indexing" && <NotIndexedNotice />}

                {pending && <SuggestionsSkeleton />}
                {!pending && suggestion && <SuggestionBody suggestion={suggestion} />}
            </section>
        </div>
    )
}

function SuggestionBody({ suggestion }: { suggestion: IssueSuggestion }) {
    const data: IssueAnalysisData | null = suggestion.data
    if (!data) {
        return (
            <div className="mt-4 anim-rise text-[13px] leading-6 text-[color:var(--c-text)]">
                {suggestion.markdown || "(no result)"}
            </div>
        )
    }
    return (
        <div className="mt-4 flex flex-col gap-5">
            {data.summary && (
                <div className="anim-rise">
                    <SectionLabel>Summary</SectionLabel>
                    <p className="mt-1 text-[13.5px] leading-relaxed text-[color:var(--c-text)]">{data.summary}</p>
                </div>
            )}
            {data.suggestions?.length > 0 && (
                <div className="anim-rise">
                    <SectionLabel>Files to investigate</SectionLabel>
                    <ul className="mt-2 flex flex-col gap-1.5">
                        {data.suggestions.map((s, i) => (
                            <FindingCard key={`${s.file}:${s.line ?? ""}:${i}`} finding={s} />
                        ))}
                    </ul>
                </div>
            )}
            {(data.confidence || suggestion.confidence) && (
                <div className="text-[11px] text-[color:var(--c-text-muted)]">
                    Confidence: <span className="font-semibold uppercase">{data.confidence ?? suggestion.confidence}</span>
                </div>
            )}
        </div>
    )
}

function FindingCard({ finding }: { finding: IssueFinding }) {
    const [open, setOpen] = useState(false)
    const filename = finding.file.split("/").pop() || finding.file
    const headline = finding.line ? `${filename}:${finding.line}` : filename
    return (
        <li className="overflow-hidden rounded-[10px] border border-[color:var(--c-border)] bg-[color:var(--c-surface-2)]">
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                aria-expanded={open}
                className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-white/60"
            >
                <span className="min-w-0 flex-1 truncate font-mono text-[12.5px]">{headline}</span>
                {finding.confidence && (
                    <span className="shrink-0 rounded-md bg-zinc-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide">
                        {finding.confidence}
                    </span>
                )}
                <svg
                    width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                    className={`shrink-0 text-[color:var(--c-text-dim)] transition-transform ${open ? "rotate-180" : ""}`}
                    aria-hidden
                >
                    <path d="M6 9l6 6 6-6" />
                </svg>
            </button>
            {open && (
                <div className="anim-fade border-t border-[color:var(--c-border)] bg-white px-3 py-2.5">
                    {finding.symbol && (
                        <div className="font-mono text-[11.5px] text-[color:var(--c-text-muted)]">{finding.symbol}</div>
                    )}
                    {finding.reason && (
                        <p className="mt-1 text-[13px] leading-5 text-[color:var(--c-text)]">{finding.reason}</p>
                    )}
                    <div className="mt-2 truncate font-mono text-[11.5px] text-[color:var(--c-text-muted)]">
                        {finding.file}
                    </div>
                </div>
            )}
        </li>
    )
}

function SuggestionsSkeleton() {
    return (
        <div className="mt-4 flex flex-col gap-5 anim-fade">
            <div>
                <SectionLabel>Summary</SectionLabel>
                <div className="mt-2 flex flex-col gap-1.5">
                    <div className="skeleton h-3 w-full rounded-full" />
                    <div className="skeleton h-3 w-11/12 rounded-full" />
                    <div className="skeleton h-3 w-2/3 rounded-full" />
                </div>
            </div>
            <div>
                <SectionLabel>Files to investigate</SectionLabel>
                <ul className="mt-2 flex flex-col gap-1.5">
                    {[0, 1, 2].map((i) => (
                        <li key={i} className="rounded-[10px] border border-[color:var(--c-border)] bg-[color:var(--c-surface-2)]">
                            <div className="flex items-center justify-between gap-2 px-3 py-2">
                                <div className="skeleton h-3 w-1/3 rounded-full" />
                                <div className="skeleton h-3 w-12 rounded-full" />
                            </div>
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    )
}

function NotIndexedNotice() {
    return (
        <p className="mt-3 anim-fade rounded-[10px] bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900">
            The maintainer's codebase graph isn't indexed yet, so AI analysis can't run. Your issue is filed and will be analysed once they index the project.
        </p>
    )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
    return <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-[color:var(--c-text-muted)]">{children}</div>
}

function StatusPill({ status }: { status: IssueStatus }) {
    return (
        <span className="rounded-full bg-[color:var(--c-surface-2)] px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.05em]">
            {status.replace(/_/g, " ")}
        </span>
    )
}

function PriorityPill({ priority }: { priority: IssuePriority }) {
    const tone =
        priority === "urgent" ? "bg-rose-50 text-rose-800" :
        priority === "high"   ? "bg-amber-50 text-amber-900" :
                                "bg-[color:var(--c-surface-2)] text-[color:var(--c-text)]"
    return (
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.05em] ${tone}`}>
            {priority}
        </span>
    )
}

function SparklesIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 3v18M3 12h18M5.5 5.5l13 13M18.5 5.5l-13 13" />
        </svg>
    )
}

function timeAgo(iso: string): string {
    const ms = Date.now() - new Date(iso).getTime()
    const s = Math.round(ms / 1000)
    if (s < 60) return `${s}s ago`
    const m = Math.round(s / 60)
    if (m < 60) return `${m}m ago`
    const h = Math.round(m / 60)
    if (h < 24) return `${h}h ago`
    const d = Math.round(h / 24)
    return `${d}d ago`
}
