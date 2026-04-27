"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { cn } from "@/components/cn"
import { createClient } from "@/lib/supabase/client"
import type { ProjectAnalyser } from "@/lib/supabase/types"

const STATUS_LABEL: Record<ProjectAnalyser["status"], { text: string; className: string }> = {
    disabled: { text: "Disabled",  className: "pill" },
    pending:  { text: "Pending",   className: "pill pill-warn" },
    indexing: { text: "Indexing…", className: "pill pill-warn" },
    ready:    { text: "Ready",     className: "pill pill-success" },
    failed:   { text: "Failed",    className: "pill pill-error" },
}

interface ProgressEvent {
    kind: string
    index?: number
    total?: number
    slug?: string
    language?: string
    message?: string
    tool_name?: string
    cumulative_usd?: number
    error?: string
}

export function AnalyserPanel({
    projectId,
    state,
}: {
    projectId: string
    state: ProjectAnalyser | null
}) {
    const router = useRouter()
    const [error, setError] = useState<string | null>(null)
    const [advanced, setAdvanced] = useState(false)
    const [token, setToken] = useState("")

    const [indexing, setIndexing] = useState(false)
    const [phase, setPhase] = useState<string | null>(null)
    const [currentSlug, setCurrentSlug] = useState<string | null>(null)
    const [stepIdx, setStepIdx] = useState<number | null>(null)
    const [stepTotal, setStepTotal] = useState<number | null>(null)
    const [costUsd, setCostUsd] = useState<number>(0)
    const startedAtRef = useRef<number | null>(null)
    const [elapsedMs, setElapsedMs] = useState(0)
    const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
    const abortRef = useRef<AbortController | null>(null)

    const enabled = !!state?.enabled
    const status = state?.status ?? "disabled"
    const isIndexing = indexing || status === "indexing"
    const showStatus = isIndexing ? "indexing" : status
    const label = STATUS_LABEL[showStatus]

    function resetLive() {
        setPhase(null)
        setCurrentSlug(null)
        setStepIdx(null)
        setStepTotal(null)
        setCostUsd(0)
        setElapsedMs(0)
        startedAtRef.current = null
    }

    // Realtime: pick up status flips from other tabs / server-side
    // updates so a refresh isn't needed. UPDATEs land when the index
    // route writes 'indexing' → 'ready' / 'failed'. router.refresh()
    // re-server-renders the page so the `state` prop updates.
    useEffect(() => {
        const supabase = createClient()
        const channel = supabase
            .channel(`project-analyser-${projectId}`)
            .on(
                "postgres_changes",
                {
                    event: "*",
                    schema: "tracker",
                    table: "project_analyser",
                    filter: `project_id=eq.${projectId}`,
                },
                () => router.refresh(),
            )
            .subscribe()
        return () => {
            void supabase.removeChannel(channel)
        }
    }, [projectId, router])

    async function call(path: string) {
        setError(null)
        const res = await fetch(`/api/projects/${projectId}/analyser/${path}`, { method: "POST" })
        if (!res.ok) {
            const e = await res.json().catch(() => ({}))
            setError(e?.error?.message || `Failed (${res.status})`)
            return
        }
        router.refresh()
    }

    async function runIndex() {
        setError(null)
        setIndexing(true)
        resetLive()
        // eslint-disable-next-line react-hooks/purity -- event handler, not render
        const startedAt = Date.now()
        startedAtRef.current = startedAt
        elapsedTimerRef.current = setInterval(() => {
            setElapsedMs(Date.now() - startedAt)
        }, 250)

        const ac = new AbortController()
        abortRef.current = ac

        try {
            const res = await fetch(`/api/projects/${projectId}/analyser/index`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(advanced && token ? { git_token: token } : {}),
                signal: ac.signal,
            })
            if (!res.ok || !res.body) {
                const e = await res.json().catch(() => ({}))
                setError(e?.error?.message || `Failed (${res.status})`)
                return
            }
            const reader = res.body.getReader()
            const decoder = new TextDecoder()
            let buf = ""
            while (true) {
                const { value, done } = await reader.read()
                if (done) break
                buf += decoder.decode(value, { stream: true })
                let i: number
                while ((i = buf.indexOf("\n")) !== -1) {
                    const line = buf.slice(0, i).trim()
                    buf = buf.slice(i + 1)
                    if (!line) continue
                    handleFrame(JSON.parse(line))
                }
            }
        } catch (e) {
            if ((e as { name?: string })?.name !== "AbortError") {
                setError(e instanceof Error ? e.message : String(e))
            }
        } finally {
            if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current)
            elapsedTimerRef.current = null
            setIndexing(false)
            router.refresh()
        }
    }

    function handleFrame(frame: Record<string, unknown>) {
        switch (frame.event) {
            case "accepted": setPhase("Cloning…"); break
            case "progress": {
                const p = frame as unknown as ProgressEvent & { event: string }
                if (typeof p.cumulative_usd === "number") setCostUsd(p.cumulative_usd)
                if (p.slug) setCurrentSlug(p.slug)
                if (typeof p.index === "number" && typeof p.total === "number") {
                    setStepIdx(p.index); setStepTotal(p.total)
                }
                setPhase(humanPhase(p))
                break
            }
            // log frames intentionally ignored — the structured progress
            // (phase + slug + step + cost) is enough; raw stdout/stderr
            // belongs in `docker compose logs server`, not the UI.
            case "done":  setPhase("Done"); break
            case "error": setError(String(frame.message ?? "indexing failed")); break
        }
    }

    return (
        <div className="card">
            <div className="card-title">
                <SparklesIcon />
                <span>Bobby-analyser</span>
                <span className={`ml-2 ${label.className}`}>{label.text}</span>
                <span className="ml-auto" />
                {enabled ? (
                    <button
                        onClick={() => call("disable")}
                        disabled={isIndexing}
                        title={isIndexing ? "Wait for the current index to finish" : undefined}
                        className="btn-ghost px-3 py-1.5 text-[12px]"
                    >
                        Disable
                    </button>
                ) : (
                    <button onClick={() => call("enable")} className="btn-primary px-3 py-1.5 text-[12px]">
                        Enable
                    </button>
                )}
            </div>
            <p className="mt-1.5 text-[12.5px] text-[color:var(--c-text-muted)]">
                Indexes the repo into a knowledge graph so issue suggestions can cite specific files and lines.
            </p>

            {enabled && (
                <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
                    <Stat label="Last indexed" value={state?.last_indexed_at ? new Date(state.last_indexed_at).toLocaleString() : "—"} />
                    <Stat label="HEAD SHA"     value={state?.last_indexed_sha ? state.last_indexed_sha.slice(0, 7) : "—"} mono />
                    <Stat label="Last cost"    value={state?.last_index_cost_usd != null ? `$${Number(state.last_index_cost_usd).toFixed(4)}` : "—"} />
                    <Stat label="Graph ID"     value={state?.graph_id || "—"} mono />
                </div>
            )}

            {enabled && (
                <div className="mt-4 flex flex-wrap items-center gap-2">
                    <button
                        onClick={runIndex}
                        disabled={isIndexing}
                        title={isIndexing && !indexing ? "An index is already in progress" : undefined}
                        className="btn-primary"
                    >
                        {isIndexing ? "Indexing…" : (state?.last_indexed_at ? "Re-index now" : "Index now")}
                    </button>
                    {!isIndexing && (
                        <button type="button" onClick={() => setAdvanced((v) => !v)} className="btn-ghost">
                            {advanced ? "Hide private-repo token" : "Private repo?"}
                        </button>
                    )}
                </div>
            )}

            {advanced && enabled && !isIndexing && (
                <div className="mt-3 rounded-[12px] border border-amber-200 bg-amber-50 p-3 text-[12px] text-amber-900">
                    <p>
                        Paste a <strong>short-lived</strong> GitHub PAT or App installation token. It&apos;s sent server-side only — never stored — and used solely for the next clone.
                    </p>
                    <input
                        value={token}
                        onChange={(e) => setToken(e.target.value)}
                        type="password"
                        placeholder="ghs_…"
                        className="input mt-2 text-[12px]"
                    />
                </div>
            )}

            {indexing && (
                <LiveProgress
                    phase={phase}
                    currentSlug={currentSlug}
                    stepIdx={stepIdx}
                    stepTotal={stepTotal}
                    costUsd={costUsd}
                    elapsedMs={elapsedMs}
                />
            )}

            {/* Server says indexing, but we don't have the live stream
                (e.g. user just opened this tab). Realtime will refresh
                the page when status flips; until then show a notice. */}
            {!indexing && status === "indexing" && (
                <p className="anim-fade mt-3 inline-flex items-center gap-2 rounded-[10px] bg-amber-50 px-3 py-1.5 text-[12px] text-amber-900">
                    <Spinner />
                    An index is in progress. This page updates live when it finishes.
                </p>
            )}

            {state?.last_error && status === "failed" && !indexing && (
                <p className="mt-3 rounded-[12px] bg-rose-50 px-3 py-2 text-[12px] text-rose-800">
                    Last error: {state.last_error}
                </p>
            )}
            {error && <p className="mt-3 text-[12px] text-rose-700">{error}</p>}
        </div>
    )
}

function Stat({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
    return (
        <div>
            <div className="text-[10.5px] font-bold uppercase tracking-[0.10em] text-[color:var(--c-text-dim)]">
                {label}
            </div>
            <div className={cn("mt-0.5 truncate text-[12.5px]", mono && "font-mono")}>{value}</div>
        </div>
    )
}

function LiveProgress({
    phase, currentSlug, stepIdx, stepTotal, costUsd, elapsedMs,
}: {
    phase: string | null
    currentSlug: string | null
    stepIdx: number | null
    stepTotal: number | null
    costUsd: number
    elapsedMs: number
}) {
    const pct = stepTotal && stepTotal > 0 && stepIdx != null ? Math.round((stepIdx / stepTotal) * 100) : null
    return (
        <div className="anim-rise mt-4 flex flex-col gap-3 rounded-[12px] border border-[color:var(--c-border)] bg-[color:var(--c-surface-2)] p-4">
            <div className="flex items-center justify-between text-[12px]">
                <div className="flex min-w-0 items-center gap-2">
                    <Spinner />
                    <span className="font-semibold text-[color:var(--c-text)]">{phase || "Starting…"}</span>
                    {currentSlug && <span className="truncate font-mono text-[color:var(--c-text-muted)]">{currentSlug}</span>}
                </div>
                <div className="flex shrink-0 items-center gap-3 tabular-nums text-[color:var(--c-text-muted)]">
                    <span>${costUsd.toFixed(4)}</span>
                    <span>{formatElapsed(elapsedMs)}</span>
                </div>
            </div>
            {pct != null && (
                <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-[color:var(--c-border)]">
                    <div
                        className="absolute inset-y-0 left-0 rounded-full bg-zinc-900 transition-[width] duration-500 ease-out"
                        style={{ width: `${pct}%` }}
                    />
                </div>
            )}
            {pct != null && (
                <div className="text-[11px] text-[color:var(--c-text-muted)]">
                    {stepIdx} / {stepTotal} modules
                </div>
            )}
        </div>
    )
}

function humanPhase(p: ProgressEvent): string {
    switch (p.kind) {
        case "clone_start":     return "Cloning repo…"
        case "clone_end":       return "Clone complete"
        case "phase1_start":    return "Phase 1 — discovery"
        case "phase2_start":    return "Phase 2 — module clusters"
        case "module_start":    return p.slug ? `Indexing ${p.slug}` : "Indexing module"
        case "module_complete": return p.slug ? `Done ${p.slug}` : "Module done"
        case "module_fail":     return p.slug ? `Failed ${p.slug}` : "Module failed"
        case "usage":           return "Model call"
        case "budget_stop":     return "Budget reached"
        case "bootstrap_end":   return "Bootstrap complete"
        default:                return p.message || p.kind
    }
}

function formatElapsed(ms: number): string {
    const s = Math.floor(ms / 1000)
    const m = Math.floor(s / 60)
    return `${m}:${String(s % 60).padStart(2, "0")}`
}

function Spinner() {
    return (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" className="animate-spin text-[color:var(--c-text-muted)]" aria-hidden>
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
            <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>
    )
}
function SparklesIcon() {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 3l1.8 4.6L18 9l-4.2 1.4L12 15l-1.8-4.6L6 9l4.2-1.4z" />
            <path d="M19 14l.9 2.3L22 17l-2.1.7L19 20l-.9-2.3L16 17l2.1-.7z" />
        </svg>
    )
}
