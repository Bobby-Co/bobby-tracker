"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import type { ProjectAnalyser } from "@/lib/supabase/types"

const STATUS_LABEL: Record<ProjectAnalyser["status"], { text: string; className: string }> = {
    disabled: { text: "Disabled",    className: "bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400" },
    pending:  { text: "Pending",     className: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300" },
    indexing: { text: "Indexing…",   className: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300" },
    ready:    { text: "Ready",       className: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300" },
    failed:   { text: "Failed",      className: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300" },
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
interface LogLine { stream: "stdout" | "stderr"; data: string }

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

    // Live indexing state — populated while the NDJSON stream is open.
    const [indexing, setIndexing] = useState(false)
    const [phase, setPhase] = useState<string | null>(null)
    const [currentSlug, setCurrentSlug] = useState<string | null>(null)
    const [stepIdx, setStepIdx] = useState<number | null>(null)
    const [stepTotal, setStepTotal] = useState<number | null>(null)
    const [costUsd, setCostUsd] = useState<number>(0)
    const [logLines, setLogLines] = useState<string[]>([])
    const startedAtRef = useRef<number | null>(null)
    const [elapsedMs, setElapsedMs] = useState(0)
    const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
    const abortRef = useRef<AbortController | null>(null)

    const enabled = !!state?.enabled
    const status = state?.status ?? "disabled"
    const showStatus = indexing ? "indexing" : status
    const label = STATUS_LABEL[showStatus]

    function appendLog(line: string) {
        setLogLines((prev) => {
            const next = [...prev, line]
            if (next.length > 500) next.splice(0, next.length - 500) // cap
            return next
        })
    }

    function resetLive() {
        setPhase(null)
        setCurrentSlug(null)
        setStepIdx(null)
        setStepTotal(null)
        setCostUsd(0)
        setLogLines([])
        setElapsedMs(0)
        startedAtRef.current = null
    }

    async function call(path: string) {
        setError(null)
        const res = await fetch(`/api/projects/${projectId}/analyser/${path}`, {
            method: "POST",
        })
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
            case "accepted":
                setPhase("Cloning…")
                break
            case "progress": {
                const p = frame as unknown as ProgressEvent & { event: string }
                if (typeof p.cumulative_usd === "number") setCostUsd(p.cumulative_usd)
                if (p.slug) setCurrentSlug(p.slug)
                if (typeof p.index === "number" && typeof p.total === "number") {
                    setStepIdx(p.index)
                    setStepTotal(p.total)
                }
                setPhase(humanPhase(p))
                break
            }
            case "log": {
                const l = frame as unknown as LogLine
                appendLog(l.data)
                break
            }
            case "done":
                setPhase("Done")
                break
            case "error":
                setError(String(frame.message ?? "indexing failed"))
                break
        }
    }

    return (
        <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
            <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">Bobby-analyser</span>
                        <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium ${label.className}`}>{label.text}</span>
                    </div>
                    <p className="mt-1 text-xs text-zinc-500">
                        Indexes the repo into a knowledge graph so issue suggestions can cite specific files and lines.
                    </p>
                </div>
                {enabled ? (
                    <button onClick={() => call("disable")} disabled={indexing} className="btn-ghost">
                        Disable
                    </button>
                ) : (
                    <button onClick={() => call("enable")} className="btn-primary">
                        Enable
                    </button>
                )}
            </div>

            {enabled && (
                <div className="mt-5 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4">
                    <Stat label="Last indexed" value={state?.last_indexed_at ? new Date(state.last_indexed_at).toLocaleString() : "—"} />
                    <Stat label="HEAD SHA"     value={state?.last_indexed_sha ? state.last_indexed_sha.slice(0, 7) : "—"} mono />
                    <Stat label="Last cost"    value={state?.last_index_cost_usd != null ? `$${Number(state.last_index_cost_usd).toFixed(4)}` : "—"} />
                    <Stat label="Graph ID"     value={state?.graph_id || "—"} mono />
                </div>
            )}

            {enabled && (
                <div className="mt-5 flex flex-wrap items-center gap-2">
                    <button
                        onClick={runIndex}
                        disabled={indexing}
                        className="btn-primary"
                    >
                        {indexing ? "Indexing…" : (state?.last_indexed_at ? "Re-index now" : "Index now")}
                    </button>
                    {!indexing && (
                        <button type="button" onClick={() => setAdvanced((v) => !v)} className="btn-ghost">
                            {advanced ? "Hide private-repo token" : "Private repo?"}
                        </button>
                    )}
                </div>
            )}

            {advanced && enabled && !indexing && (
                <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs dark:border-amber-900 dark:bg-amber-950/40">
                    <p className="text-amber-900 dark:text-amber-200">
                        Paste a <strong>short-lived</strong> GitHub PAT or App installation token. It&apos;s sent server-side only — never stored — and used solely for the next clone.
                    </p>
                    <input
                        value={token}
                        onChange={(e) => setToken(e.target.value)}
                        type="password"
                        placeholder="ghs_…"
                        className="input mt-2 text-xs"
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
                    logLines={logLines}
                />
            )}

            {state?.last_error && status === "failed" && !indexing && (
                <p className="mt-3 rounded-lg bg-red-50 p-3 text-xs text-red-800 dark:bg-red-950/40 dark:text-red-300">
                    Last error: {state.last_error}
                </p>
            )}
            {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
        </div>
    )
}

function Stat({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
    return (
        <div>
            <div className="text-[11px] uppercase tracking-wider text-zinc-500">{label}</div>
            <div className={`mt-0.5 truncate ${mono ? "font-mono" : ""}`}>{value}</div>
        </div>
    )
}

function LiveProgress({
    phase,
    currentSlug,
    stepIdx,
    stepTotal,
    costUsd,
    elapsedMs,
    logLines,
}: {
    phase: string | null
    currentSlug: string | null
    stepIdx: number | null
    stepTotal: number | null
    costUsd: number
    elapsedMs: number
    logLines: string[]
}) {
    const pct = stepTotal && stepTotal > 0 && stepIdx != null ? Math.round((stepIdx / stepTotal) * 100) : null
    return (
        <div className="mt-4 anim-rise flex flex-col gap-3 rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex items-center justify-between text-xs">
                <div className="flex min-w-0 items-center gap-2">
                    <Spinner />
                    <span className="font-medium text-zinc-900 transition-opacity dark:text-zinc-100">{phase || "Starting…"}</span>
                    {currentSlug && (
                        <span className="truncate font-mono text-zinc-500">{currentSlug}</span>
                    )}
                </div>
                <div className="flex shrink-0 items-center gap-3 tabular-nums text-zinc-500">
                    <span>${costUsd.toFixed(4)}</span>
                    <span>{formatElapsed(elapsedMs)}</span>
                </div>
            </div>

            {pct != null && (
                <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                    <div
                        className="absolute inset-y-0 left-0 bg-zinc-900 transition-[width] duration-500 ease-out dark:bg-zinc-100"
                        style={{ width: `${pct}%` }}
                    />
                </div>
            )}
            {pct != null && (
                <div className="text-[11px] text-zinc-500">
                    {stepIdx} / {stepTotal} modules
                </div>
            )}

            <details className="text-[11px]">
                <summary className="cursor-pointer text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
                    Show stream ({logLines.length})
                </summary>
                <pre className="mt-2 max-h-64 overflow-auto rounded bg-black p-2 font-mono text-[11px] leading-snug text-green-200">
                    {logLines.length === 0 ? "(no log lines yet)" : logLines.join("\n")}
                </pre>
            </details>
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
        case "tool_call":       return p.tool_name ? `Tool: ${p.tool_name}` : "Tool call"
        case "tool_result":     return "Tool result"
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
        <svg className="h-3 w-3 animate-spin text-zinc-500" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
            <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>
    )
}
