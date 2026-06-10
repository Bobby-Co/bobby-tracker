"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import { cn } from "@/components/cn"
import { EffortControl, EFFORT_LABEL } from "@/components/effort-control"
import { createClient } from "@/lib/supabase/client"
import { blobUrl, type RepoRef } from "@/lib/github"
import type { AnalyseEffort } from "@/lib/analyser"
import type { IssueAnalysisData, IssueFinding, IssueSuggestion } from "@/lib/supabase/types"

interface Props {
    issueId: string
    projectId: string
    repo: RepoRef
    indexedSha: string | null
    initial: IssueSuggestion | null
    analyserReady: boolean
    /** The issue's stored per-issue effort (create-time advanced setting).
     *  Seeds the popover unless the user overrides it this session. */
    issueEffort: AnalyseEffort | null
}

export function IssueSuggestions({ issueId, projectId, repo, indexedSha, initial, analyserReady, issueEffort }: Props) {
    const [suggestion, setSuggestion] = useState<IssueSuggestion | null>(initial)
    const [error, setError] = useState<string | null>(null)
    const [errorCode, setErrorCode] = useState<string | null>(null)
    const [pending, startTransition] = useTransition()
    const autoFiredRef = useRef(false)

    // Effort the popover shows + sends. `effort` is the user's explicit pick
    // this session (null until they touch the slider). The control displays
    // the first of (explicit pick → the issue's stored effort → project
    // default → "medium"). We forward an effort ONLY when the user explicitly
    // picked one — otherwise the request omits it so the server resolves the
    // chain itself (issue's stored effort → project default → server default).
    const [effort, setEffort] = useState<AnalyseEffort | null>(null)
    const [projectDefault, setProjectDefault] = useState<AnalyseEffort | null>(null)
    const [effortOpen, setEffortOpen] = useState(false)
    const effortRef = useRef<HTMLDivElement>(null)
    const displayEffort: AnalyseEffort = effort ?? issueEffort ?? projectDefault ?? "medium"

    // The effort control morphs by animating the surface's real width/height
    // (NOT a transform scale — scale distorts the content). We measure the
    // chip and the panel so the surface can size to either exactly, and the
    // content cross-fades on top. A ResizeObserver keeps the measurements
    // live as the label or the (level-dependent) disclaimer text changes.
    const chipRef = useRef<HTMLButtonElement>(null)
    const panelRef = useRef<HTMLDivElement>(null)
    const [chipSize, setChipSize] = useState({ w: 116, h: 32 })
    const [panelSize, setPanelSize] = useState({ w: 320, h: 150 })
    useEffect(() => {
        const ro = new ResizeObserver((entries) => {
            for (const e of entries) {
                const el = e.target as HTMLElement
                const size = { w: el.offsetWidth, h: el.offsetHeight }
                if (el === chipRef.current) setChipSize(size)
                else if (el === panelRef.current) setPanelSize(size)
            }
        })
        if (chipRef.current) ro.observe(chipRef.current)
        if (panelRef.current) ro.observe(panelRef.current)
        return () => ro.disconnect()
    }, [])

    function regenerate() {
        setError(null)
        setErrorCode(null)
        setEffortOpen(false)
        startTransition(async () => {
            const res = await fetch(`/api/issues/${issueId}/suggest`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(effort ? { effort } : {}),
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

    // Sync the server-rendered prop into local state on changes. Without
    // this, a router.refresh that surfaces a freshly-inserted suggestion
    // (from another tab, cron, etc.) would be ignored because useState
    // only honours the initial value.
    useEffect(() => {
        setSuggestion(initial)
    }, [initial])

    // Fetch the project's saved default effort so the slider pre-selects it.
    // Display-only: it never forces an effort onto a request (see `effort`).
    useEffect(() => {
        let cancelled = false
        ;(async () => {
            try {
                const res = await fetch(`/api/projects/${projectId}/issue-preferences`, { cache: "no-store" })
                if (!res.ok || cancelled) return
                const { effort: def } = (await res.json()) as { effort: AnalyseEffort | "" }
                if (!cancelled && def) setProjectDefault(def)
            } catch {}
        })()
        return () => {
            cancelled = true
        }
    }, [projectId])

    // Dismiss the effort popover on outside click or Escape.
    useEffect(() => {
        if (!effortOpen) return
        function onDown(e: MouseEvent) {
            if (effortRef.current && !effortRef.current.contains(e.target as Node)) setEffortOpen(false)
        }
        function onKey(e: KeyboardEvent) {
            if (e.key === "Escape") setEffortOpen(false)
        }
        document.addEventListener("mousedown", onDown)
        document.addEventListener("keydown", onKey)
        return () => {
            document.removeEventListener("mousedown", onDown)
            document.removeEventListener("keydown", onKey)
        }
    }, [effortOpen])

    // Auto-trigger when the issue lands on this page with no cached
    // suggestion AND the analyser is ready. Fires once per mount so a
    // user revisiting an unanswered issue gets investigation started
    // without an extra click. The setState happens via startTransition
    // inside regenerate(), not synchronously in the effect body — but
    // the lint rule fires on the call site regardless, so suppress.
    useEffect(() => {
        if (autoFiredRef.current) return
        if (!analyserReady) return
        if (suggestion) return
        autoFiredRef.current = true
        // eslint-disable-next-line react-hooks/set-state-in-effect -- regenerate() defers via startTransition; this is the right pattern for "kick off when conditions become true"
        regenerate()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [analyserReady, suggestion?.id])

    // Realtime: pick up new suggestion rows even when this tab didn't
    // start the investigation (background regeneration, parallel tab,
    // etc.). RLS on tracker.issue_suggestions ensures only authorised
    // rows arrive.
    useEffect(() => {
        const supabase = createClient()
        const channel = supabase
            .channel(`issue-suggestions-${issueId}`)
            .on(
                "postgres_changes",
                {
                    event: "INSERT",
                    schema: "tracker",
                    table: "issue_suggestions",
                    filter: `issue_id=eq.${issueId}`,
                },
                (payload) => setSuggestion(payload.new as IssueSuggestion),
            )
            .subscribe()
        return () => {
            void supabase.removeChannel(channel)
        }
    }, [issueId])

    // Polling fallback while an investigation is in flight. The /suggest
    // POST blocks for the full analyser run (~30s), which is long enough
    // for proxies / fetch idle timeouts to drop the response even after
    // the row has been inserted. Realtime should pick it up, but if WAL
    // events are being dropped the user would otherwise sit on the
    // spinner until they reload. Bounded to `pending` so it stops the
    // moment any path delivers the row.
    useEffect(() => {
        if (!pending) return
        let cancelled = false
        const tick = async () => {
            try {
                const res = await fetch(`/api/issues/${issueId}/suggestions`, { cache: "no-store" })
                if (!res.ok || cancelled) return
                const { suggestion: latest } = (await res.json()) as { suggestion: IssueSuggestion | null }
                if (!latest || cancelled) return
                setSuggestion(latest)
            } catch {}
        }
        const id = setInterval(tick, 3000)
        return () => {
            cancelled = true
            clearInterval(id)
        }
    }, [pending, issueId])

    return (
        <div className="rainbow-glow rounded-xl">
        <section className="rounded-xl border border-transparent bg-white p-4 transition-colors dark:bg-zinc-950">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <h2 className="flex items-center gap-2 text-sm font-medium">
                        <SparklesIcon spinning={pending} />
                        Investigate with analyser
                    </h2>
                    <p className="mt-0.5 text-xs text-zinc-500 transition-opacity">
                        {pending
                            ? "Reading the graph and source — typically 10–30s."
                            : suggestion
                                ? <>Cached {timeAgo(suggestion.created_at)} · ${Number(suggestion.cost_usd ?? 0).toFixed(4)}</>
                                : "Ask the indexed graph which files and lines to look at first."}
                    </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                    {/* Effort selector. ONE surface whose BACKGROUND grows/shrinks
                        by animating real width + height (no transform scale, so
                        nothing distorts); the chip and panel are layered on top and
                        cross-fade — content fades IN after the box has grown, and
                        OUT before it shrinks. Sizes come from measuring each layer
                        (see chipSize/panelSize) so it's exact at any content size.
                        The invisible placeholder holds the chip's footprint so the
                        absolutely-positioned surface never shifts Regenerate. */}
                    <div className="relative" ref={effortRef}>
                        <span
                            aria-hidden
                            className="pointer-events-none inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] opacity-0"
                        >
                            <SlidersIcon />
                            <span className="hidden sm:inline">{EFFORT_LABEL[displayEffort]}</span>
                            <ChevronIcon />
                        </span>
                        <div
                            className="absolute right-0 top-0 z-20 overflow-hidden bg-white ring-1 ring-inset ring-zinc-200 dark:bg-zinc-950 dark:ring-zinc-800"
                            style={{
                                width: effortOpen ? panelSize.w : chipSize.w,
                                height: effortOpen ? panelSize.h : chipSize.h,
                                borderRadius: effortOpen ? 12 : 8,
                                boxShadow: effortOpen ? "0 12px 32px rgba(0,0,0,0.16)" : "0 1px 2px rgba(0,0,0,0.06)",
                                transition:
                                    "width .26s cubic-bezier(.22,.8,.26,1), height .26s cubic-bezier(.22,.8,.26,1), border-radius .2s ease, box-shadow .26s ease",
                            }}
                        >
                            {/* Chip layer — fades out immediately on open, in after
                                the box has finished shrinking on close. */}
                            <button
                                ref={chipRef}
                                type="button"
                                onClick={() => setEffortOpen(true)}
                                disabled={pending}
                                aria-haspopup="dialog"
                                aria-expanded={effortOpen}
                                title="Choose how thorough the analyser is for this issue"
                                className="absolute left-0 top-0 flex items-center gap-1.5 whitespace-nowrap px-2.5 py-1.5 text-[12px] font-medium hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-zinc-900"
                                style={{
                                    opacity: effortOpen ? 0 : 1,
                                    pointerEvents: effortOpen ? "none" : "auto",
                                    transition: "opacity .14s ease",
                                    transitionDelay: effortOpen ? "0s" : ".16s",
                                }}
                            >
                                <SlidersIcon />
                                <span className="hidden sm:inline">{EFFORT_LABEL[displayEffort]}</span>
                                <ChevronIcon open={effortOpen} />
                            </button>

                            {/* Panel layer — fades in after the box has grown,
                                out immediately on close. */}
                            <div
                                ref={panelRef}
                                role="dialog"
                                aria-label="Analyser effort"
                                className="absolute left-0 top-0 w-80 p-3.5"
                                style={{
                                    opacity: effortOpen ? 1 : 0,
                                    pointerEvents: effortOpen ? "auto" : "none",
                                    transition: "opacity .14s ease",
                                    transitionDelay: effortOpen ? ".16s" : "0s",
                                }}
                            >
                                <div className="mb-2 flex items-center justify-between">
                                    <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                                        Analyser effort
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => setEffortOpen(false)}
                                        tabIndex={effortOpen ? 0 : -1}
                                        className="-mr-1 rounded p-0.5 text-zinc-400 transition-colors hover:text-zinc-600 dark:hover:text-zinc-300"
                                        aria-label="Close effort picker"
                                    >
                                        <CloseIcon />
                                    </button>
                                </div>
                                <EffortControl
                                    value={displayEffort}
                                    onChange={setEffort}
                                    disabled={pending}
                                    ariaLabel="Analyser effort for this issue"
                                />
                            </div>
                        </div>
                    </div>
                    <button
                        onClick={regenerate}
                        disabled={pending || !analyserReady}
                        className="btn-primary group relative overflow-hidden"
                        title={!analyserReady ? "Enable and index the project first" : undefined}
                    >
                        <span className={pending ? "opacity-0" : "opacity-100 transition-opacity"}>
                            {suggestion ? "Regenerate" : "Investigate"}
                        </span>
                        {pending && (
                            <span className="absolute inset-0 flex items-center justify-center gap-2 anim-fade">
                                <SmallSpinner />
                                <span>Investigating…</span>
                            </span>
                        )}
                    </button>
                </div>
            </div>

            {!analyserReady && !suggestion && !pending && <NeedsIndexing />}

            {error && (
                <div className="mt-3 anim-fade rounded-lg bg-red-50 p-3 text-xs text-red-800 dark:bg-red-950/40 dark:text-red-300">
                    {errorCode === "needs_indexing" ? <NeedsIndexing /> : <p>{error}</p>}
                </div>
            )}

            {pending && <SuggestionsSkeleton />}
            {!pending && suggestion && (
                <SuggestionBody key={suggestion.id} suggestion={suggestion} repo={repo} indexedSha={indexedSha} />
            )}
        </section>
        </div>
    )
}

function SuggestionBody({
    suggestion,
    repo,
    indexedSha,
}: {
    suggestion: IssueSuggestion
    repo: RepoRef
    indexedSha: string | null
}) {
    // Always prefer the structured payload now. Legacy rows without
    // `data` are vanishingly rare after the migration; treat them as a
    // bare summary string.
    const data: IssueAnalysisData | null = suggestion.data
    if (!data) {
        return (
            <div className="mt-4 anim-rise text-[13px] leading-6 text-zinc-700 dark:text-zinc-300">
                {suggestion.markdown || "(no result)"}
            </div>
        )
    }

    return (
        <div
            className="mt-4 flex flex-col gap-5 stagger"
            style={{ ["--stagger-step" as string]: "70ms" } as React.CSSProperties}
        >
            {data.summary && (
                <div className="anim-rise" style={{ ["--i" as string]: 0 } as React.CSSProperties}>
                    <SectionLabel>Summary</SectionLabel>
                    <p className="mt-1 text-sm leading-6 text-zinc-700 dark:text-zinc-300">{data.summary}</p>
                </div>
            )}

            {data.suggestions.length > 0 && (
                <div className="anim-rise" style={{ ["--i" as string]: 1 } as React.CSSProperties}>
                    <SectionLabel>Files to investigate</SectionLabel>
                    <ul
                        className="mt-2 flex flex-col gap-1.5 stagger"
                        style={{ ["--stagger-step" as string]: "55ms" } as React.CSSProperties}
                    >
                        {data.suggestions.map((s, i) => (
                            <FindingCard
                                key={`${s.file}:${s.line ?? ""}:${i}`}
                                finding={s}
                                repo={repo}
                                sha={indexedSha}
                                index={i}
                            />
                        ))}
                    </ul>
                </div>
            )}

            <div className="anim-rise" style={{ ["--i" as string]: 2 } as React.CSSProperties}>
                <MetaRow
                    confidence={data.confidence ?? suggestion.confidence ?? null}
                    graphId={suggestion.graph_id}
                    sha={indexedSha}
                    durationMs={suggestion.duration_ms ?? data.duration_ms ?? null}
                />
            </div>
        </div>
    )
}

// FindingCard — collapsed by default, showing just `basename:line` +
// confidence badge on the right. Click expands to reveal the reason,
// optional symbol, and a link to the full path on GitHub.
function FindingCard({
    finding,
    repo,
    sha,
    index,
}: {
    finding: IssueFinding
    repo: RepoRef
    sha: string | null
    index: number
}) {
    const [open, setOpen] = useState(false)
    const url = blobUrl(repo, finding.file, finding.line, sha)
    const filename = basename(finding.file)
    const headline = finding.line ? `${filename}:${finding.line}` : filename

    return (
        <li
            className="anim-rise overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50 transition-all duration-200 hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700"
            style={{ ["--i" as string]: index } as React.CSSProperties}
        >
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                aria-expanded={open}
                className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-white/60 dark:hover:bg-zinc-900/60"
            >
                <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-zinc-900 dark:text-zinc-100">
                    {headline}
                </span>
                {finding.symbol && !open && (
                    <span className="hidden font-mono text-[11px] text-zinc-500 sm:inline">
                        {finding.symbol}
                    </span>
                )}
                {finding.confidence && <ConfidenceBadge value={finding.confidence} />}
                <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    className={cn(
                        "shrink-0 text-zinc-400 transition-transform duration-200",
                        open && "rotate-180",
                    )}
                    aria-hidden
                >
                    <path d="M6 9l6 6 6-6" />
                </svg>
            </button>

            {open && (
                <div className="anim-fade border-t border-zinc-200/60 bg-white px-3 py-2.5 dark:border-zinc-800/60 dark:bg-zinc-950">
                    {finding.symbol && (
                        <div className="font-mono text-[11.5px] text-zinc-500 dark:text-zinc-400">
                            {finding.symbol}
                        </div>
                    )}
                    {finding.reason && (
                        <p className="mt-1 text-[13px] leading-5 text-zinc-700 dark:text-zinc-300">
                            {finding.reason}
                        </p>
                    )}
                    {url ? (
                        <a
                            href={url}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-2.5 inline-flex max-w-full items-center gap-1.5 truncate font-mono text-[11.5px] text-zinc-500 hover:text-blue-600 hover:underline dark:hover:text-blue-400"
                        >
                            <span className="truncate">{finding.file}</span>
                            <ExternalLinkIcon />
                        </a>
                    ) : (
                        <span className="mt-2.5 inline-block max-w-full truncate font-mono text-[11.5px] text-zinc-500">
                            {finding.file}
                        </span>
                    )}
                </div>
            )}
        </li>
    )
}

function ConfidenceBadge({ value }: { value: string }) {
    const v = value.toLowerCase()
    const cls =
        v === "high"   ? "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300" :
        v === "medium" ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300" :
        v === "low"    ? "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400" :
                         "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
    return (
        <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide transition-colors ${cls}`}>
            {v}
        </span>
    )
}

function MetaRow({
    confidence,
    graphId,
    sha,
    durationMs,
}: {
    confidence: string | null
    graphId: string | null
    sha: string | null
    durationMs: number | null
}) {
    return (
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
            {confidence && <ConfidenceBadge value={confidence} />}
            {graphId && <Pill mono>graph: {graphId}</Pill>}
            {sha && <Pill mono>sha: {sha.slice(0, 7)}</Pill>}
            {durationMs != null && <Pill>{(durationMs / 1000).toFixed(1)}s</Pill>}
        </div>
    )
}

function SuggestionsSkeleton() {
    return (
        <div className="mt-4 flex flex-col gap-5 anim-fade">
            <div>
                <SectionLabel>Summary</SectionLabel>
                <div className="mt-2 flex flex-col gap-1.5">
                    <div className="skeleton h-3 w-full" />
                    <div className="skeleton h-3 w-11/12" />
                    <div className="skeleton h-3 w-2/3" />
                </div>
            </div>
            <div>
                <SectionLabel>Files to investigate</SectionLabel>
                <ul className="mt-2 flex flex-col gap-1.5">
                    {[0, 1, 2].map((i) => (
                        <li
                            key={i}
                            className="rounded-lg border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900"
                        >
                            <div className="flex items-center justify-between gap-2 px-3 py-2">
                                <div className="skeleton h-3 w-1/3" />
                                <div className="skeleton h-3 w-12" />
                            </div>
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    )
}

function NeedsIndexing() {
    return (
        <p className="mt-3 anim-fade rounded-lg bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
            Enable the <strong>bobby-analyser</strong> integration on this project and run <em>Index now</em> first. Suggestions need an indexed knowledge graph to cite files and lines.
        </p>
    )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
    return <div className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">{children}</div>
}

function Pill({ children, mono }: { children: React.ReactNode; mono?: boolean }) {
    return (
        <span
            className={`rounded-md bg-zinc-100 px-1.5 py-0.5 transition-colors dark:bg-zinc-800 ${mono ? "font-mono" : ""}`}
        >
            {children}
        </span>
    )
}

function basename(path: string): string {
    return path.split("/").pop() || path
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

function SparklesIcon({ spinning }: { spinning?: boolean }) {
    return (
        <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={spinning ? "animate-pulse" : ""}
            aria-hidden
        >
            <path d="M12 3v18M3 12h18M5.5 5.5l13 13M18.5 5.5l-13 13" />
        </svg>
    )
}
function ExternalLinkIcon({ className = "" }: { className?: string }) {
    return (
        <svg
            width="11"
            height="11"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
            className={className}
        >
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3" />
        </svg>
    )
}
function SlidersIcon() {
    return (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" />
        </svg>
    )
}
function ChevronIcon({ open }: { open?: boolean }) {
    return (
        <svg
            width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden
            className={cn("transition-transform duration-200", open && "rotate-180")}
        >
            <path d="M6 9l6 6 6-6" />
        </svg>
    )
}
function CloseIcon() {
    return (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
            <path d="M6 6l12 12M18 6L6 18" />
        </svg>
    )
}
function SmallSpinner() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="animate-spin" aria-hidden>
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
            <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>
    )
}
