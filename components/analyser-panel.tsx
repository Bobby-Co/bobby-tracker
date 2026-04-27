"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import type { ProjectAnalyser } from "@/lib/supabase/types"

const STATUS_LABEL: Record<ProjectAnalyser["status"], { text: string; className: string }> = {
    disabled: { text: "Disabled",    className: "bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400" },
    pending:  { text: "Pending",     className: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300" },
    indexing: { text: "Indexing…",   className: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300" },
    ready:    { text: "Ready",       className: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300" },
    failed:   { text: "Failed",      className: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300" },
}

export function AnalyserPanel({
    projectId,
    state,
}: {
    projectId: string
    state: ProjectAnalyser | null
}) {
    const router = useRouter()
    const [pending, startTransition] = useTransition()
    const [error, setError] = useState<string | null>(null)
    const [advanced, setAdvanced] = useState(false)
    const [token, setToken] = useState("")

    const enabled = !!state?.enabled
    const status = state?.status ?? "disabled"
    const label = STATUS_LABEL[status]

    function call(path: string, body?: unknown) {
        setError(null)
        startTransition(async () => {
            const res = await fetch(`/api/projects/${projectId}/analyser/${path}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: body ? JSON.stringify(body) : undefined,
            })
            if (!res.ok) {
                const e = await res.json().catch(() => ({}))
                setError(e?.error?.message || `Failed (${res.status})`)
                return
            }
            router.refresh()
        })
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
                    <button onClick={() => call("disable")} disabled={pending} className="btn-ghost">
                        {pending ? "…" : "Disable"}
                    </button>
                ) : (
                    <button onClick={() => call("enable")} disabled={pending} className="btn-primary">
                        {pending ? "…" : "Enable"}
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
                        onClick={() => call("index", advanced && token ? { git_token: token } : undefined)}
                        disabled={pending || status === "indexing"}
                        className="btn-primary"
                    >
                        {status === "indexing" ? "Indexing…" : (state?.last_indexed_at ? "Re-index now" : "Index now")}
                    </button>
                    <button
                        type="button"
                        onClick={() => setAdvanced((v) => !v)}
                        className="btn-ghost"
                    >
                        {advanced ? "Hide private-repo token" : "Private repo?"}
                    </button>
                </div>
            )}

            {advanced && enabled && (
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

            {state?.last_error && status === "failed" && (
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
