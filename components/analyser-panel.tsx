"use client"

import { useEffect, useState } from "react"
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

export function AnalyserPanel({
    projectId,
    state,
}: {
    projectId: string
    state: ProjectAnalyser | null
}) {
    const router = useRouter()
    // Local mirror of the DB row so realtime updates land instantly
    // without waiting on a server re-render. Initialised from the
    // server-rendered prop and overwritten by realtime payloads.
    const [analyser, setAnalyser] = useState<ProjectAnalyser | null>(state)
    const [error, setError] = useState<string | null>(null)
    const [advanced, setAdvanced] = useState(false)
    const [token, setToken] = useState("")
    const [busy, setBusy] = useState(false) // toggling enable/disable/index buttons

    const enabled = !!analyser?.enabled
    const status = analyser?.status ?? "disabled"
    const isIndexing = status === "indexing"
    const label = STATUS_LABEL[status]

    // Sync the server-rendered prop into local state on changes. Without
    // this, useState's initial-value-only behaviour would swallow the
    // refreshed row after enable/disable calls (which run router.refresh)
    // and the panel would stay stale unless realtime happened to deliver.
    useEffect(() => {
        setAnalyser(state)
    }, [state])

    // Realtime: every UPDATE/INSERT to project_analyser for this project
    // lands here. Update local state inline (no router.refresh — that
    // would re-render the whole page on every progress write). When the
    // status flips out of indexing, run a refresh once so other parts of
    // the page that depend on it (e.g. issue suggestions auto-trigger)
    // re-evaluate.
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
                (payload) => {
                    const next = payload.new as ProjectAnalyser
                    setAnalyser((prev) => {
                        if (prev && prev.status === "indexing" && next.status !== "indexing") {
                            // Status terminal: refresh server-side bits.
                            queueMicrotask(() => router.refresh())
                        }
                        return next
                    })
                },
            )
            .subscribe()
        return () => {
            void supabase.removeChannel(channel)
        }
    }, [projectId, router])

    // Polling fallback for active states. Realtime is the primary path,
    // but if WAL events are dropped (RLS edge cases, dropped websocket,
    // unapplied migration in a fresh env, etc.) the UI would otherwise
    // sit on "Indexing…" until the user reloads. Bounded to pending +
    // indexing so we don't poll the row when there's nothing to watch.
    useEffect(() => {
        if (status !== "indexing" && status !== "pending") return
        let cancelled = false
        const tick = async () => {
            try {
                const res = await fetch(`/api/projects/${projectId}/analyser/status`, { cache: "no-store" })
                if (!res.ok || cancelled) return
                const { analyser: latest } = (await res.json()) as { analyser: ProjectAnalyser | null }
                if (!latest || cancelled) return
                setAnalyser((prev) => {
                    if (prev && prev.status === "indexing" && latest.status !== "indexing") {
                        queueMicrotask(() => router.refresh())
                    }
                    return latest
                })
            } catch {}
        }
        const id = setInterval(tick, 3000)
        return () => {
            cancelled = true
            clearInterval(id)
        }
    }, [status, projectId, router])

    async function call(path: string, body?: unknown) {
        setError(null)
        setBusy(true)
        try {
            const res = await fetch(`/api/projects/${projectId}/analyser/${path}`, {
                method: "POST",
                headers: body ? { "Content-Type": "application/json" } : undefined,
                body: body ? JSON.stringify(body) : undefined,
            })
            if (!res.ok && res.status !== 202) {
                const e = await res.json().catch(() => ({}))
                setError(e?.error?.message || `Failed (${res.status})`)
                return
            }
            // enable/disable return the upserted row — apply it to local
            // state immediately so the pill flips without waiting on
            // realtime (which may be lossy) or the round-trip refresh.
            if (path !== "index") {
                const data = await res.json().catch(() => null) as { analyser?: ProjectAnalyser } | null
                if (data?.analyser) setAnalyser(data.analyser)
                router.refresh()
            }
        } finally {
            setBusy(false)
        }
    }

    function runIndex() {
        // Optimistic flip: the route upserts status='indexing' before
        // returning 202, but realtime may take a beat to deliver it.
        // Mirror that locally so the UI reacts on click.
        setAnalyser((prev) =>
            prev
                ? { ...prev, status: "indexing", last_error: null, progress: { phase: "Starting…", started_at: new Date().toISOString() } }
                : prev,
        )
        const payload = advanced && token ? { git_token: token } : undefined
        void call("index", payload)
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
                        disabled={isIndexing || busy}
                        title={isIndexing ? "Wait for the current index to finish" : undefined}
                        className="btn-ghost px-3 py-1.5 text-[12px]"
                    >
                        Disable
                    </button>
                ) : (
                    <button onClick={() => call("enable")} disabled={busy} className="btn-primary px-3 py-1.5 text-[12px]">
                        Enable
                    </button>
                )}
            </div>
            <p className="mt-1.5 text-[12.5px] text-[color:var(--c-text-muted)]">
                Indexes the repo into a knowledge graph so issue suggestions can cite specific files and lines.
            </p>

            {enabled && (
                <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
                    <Stat label="Last indexed" value={analyser?.last_indexed_at ? new Date(analyser.last_indexed_at).toLocaleString() : "—"} />
                    <Stat label="HEAD SHA"     value={analyser?.last_indexed_sha ? analyser.last_indexed_sha.slice(0, 7) : "—"} mono />
                    <Stat label="Last cost"    value={analyser?.last_index_cost_usd != null ? `$${Number(analyser.last_index_cost_usd).toFixed(4)}` : "—"} />
                    <Stat label="Graph ID"     value={analyser?.graph_id || "—"} mono />
                </div>
            )}

            {enabled && (
                <div className="mt-4 flex flex-wrap items-center gap-2">
                    <button
                        onClick={runIndex}
                        disabled={isIndexing || busy}
                        className="btn-primary"
                    >
                        {isIndexing ? "Indexing…" : (analyser?.last_indexed_at ? "Re-index now" : "Index now")}
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

            {isIndexing && <LiveProgress progress={analyser?.progress ?? null} />}

            {analyser?.last_error && status === "failed" && (
                <p className="mt-3 rounded-[12px] bg-rose-50 px-3 py-2 text-[12px] text-rose-800">
                    Last error: {analyser.last_error}
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

// LiveProgress renders directly from the DB-backed progress snapshot.
// It uses an internal ticker for elapsed time so it ticks every 250ms
// even when no realtime event has arrived; everything else (phase,
// slug, step counts, cumulative cost) advances when realtime delivers
// the next row update.
function LiveProgress({ progress }: { progress: ProjectAnalyser["progress"] }) {
    const startedAt = progress?.started_at ? new Date(progress.started_at).getTime() : null
    const [now, setNow] = useState(() => Date.now())

    useEffect(() => {
        if (!startedAt) return
        const id = setInterval(() => setNow(Date.now()), 250)
        return () => clearInterval(id)
    }, [startedAt])

    const elapsedMs = startedAt ? now - startedAt : 0
    const phase = progress?.phase || "Starting…"
    const slug = progress?.slug
    const stepIdx = progress?.step_idx
    const stepTotal = progress?.step_total
    const costUsd = progress?.cost_usd ?? 0
    const pct =
        stepTotal && stepTotal > 0 && stepIdx != null ? Math.round((stepIdx / stepTotal) * 100) : null

    return (
        <div className="anim-rise mt-4 flex flex-col gap-3 rounded-[12px] border border-[color:var(--c-border)] bg-[color:var(--c-surface-2)] p-4">
            <div className="flex items-center justify-between text-[12px]">
                <div className="flex min-w-0 items-center gap-2">
                    <Spinner />
                    <span className="font-semibold text-[color:var(--c-text)]">{phase}</span>
                    {slug && <span className="truncate font-mono text-[color:var(--c-text-muted)]">{slug}</span>}
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

function formatElapsed(ms: number): string {
    if (ms <= 0) return "0:00"
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
