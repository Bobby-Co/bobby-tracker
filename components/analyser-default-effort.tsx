"use client"

import { useEffect, useState } from "react"
import { cn } from "@/components/cn"
import { EffortControl } from "@/components/effort-control"
import type { AnalyseEffort } from "@/lib/analyser"

type Current = AnalyseEffort | ""

// Per-project default analyser effort. Reads/writes the bobby-analyser
// preference for this project's indexed graph via the tracker proxy route.
// "" means no default is set, so analyses fall back to the analyser's own
// built-in default until one is chosen here.
export function AnalyserDefaultEffort({ projectId }: { projectId: string }) {
    const [current, setCurrent] = useState<Current>("")
    const [indexed, setIndexed] = useState<boolean>(true)
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [saved, setSaved] = useState(false)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        let cancelled = false
        ;(async () => {
            try {
                const res = await fetch(`/api/projects/${projectId}/issue-preferences`, { cache: "no-store" })
                const body = await res.json().catch(() => ({}))
                if (cancelled) return
                if (!res.ok) {
                    setError(body?.error?.message || `Failed (${res.status})`)
                    return
                }
                setCurrent((body?.effort as Current) || "")
                setIndexed(body?.indexed !== false)
            } catch {
                if (!cancelled) setError("Could not load the analyser preference.")
            } finally {
                if (!cancelled) setLoading(false)
            }
        })()
        return () => {
            cancelled = true
        }
    }, [projectId])

    async function save(next: Current) {
        setError(null)
        setSaving(true)
        setSaved(false)
        // Optimistic — reflect the choice immediately; revert on error.
        const prev = current
        setCurrent(next)
        try {
            const res = await fetch(`/api/projects/${projectId}/issue-preferences`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ effort: next }),
            })
            const body = await res.json().catch(() => ({}))
            if (!res.ok) {
                setCurrent(prev)
                setError(body?.error?.message || `Failed (${res.status})`)
                return
            }
            setCurrent((body?.effort as Current) || "")
            setSaved(true)
        } catch {
            setCurrent(prev)
            setError("Could not save the analyser preference.")
        } finally {
            setSaving(false)
        }
    }

    // Clear the transient "Saved" confirmation a moment after it shows.
    useEffect(() => {
        if (!saved) return
        const id = setTimeout(() => setSaved(false), 2200)
        return () => clearTimeout(id)
    }, [saved])

    const disabled = loading || saving || !indexed

    return (
        <div className="card">
            <div className="card-title">
                <GaugeIcon />
                <span>Analyser effort default</span>
                <span className="ml-auto" />
                {saving && <span className="pill pill-warn">Saving…</span>}
                {saved && !saving && <span className="pill pill-success">Saved</span>}
            </div>
            <p className="mt-1.5 text-[12.5px] text-[color:var(--c-text-muted)]">
                How thorough the analyser is when investigating issues in this project. Higher
                levels explore more before answering — slower and more expensive, but better on
                hard multi-file bugs. Individual issues can override this.
            </p>

            <div className={cn("mt-4", current === "" && "opacity-60")}>
                <EffortControl
                    value={current || "medium"}
                    onChange={(level) => save(level)}
                    disabled={disabled}
                    className="max-w-sm"
                    ariaLabel="Project default analyser effort"
                />
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-3">
                <button
                    type="button"
                    onClick={() => save("")}
                    disabled={disabled || current === ""}
                    className="btn-ghost px-3 py-1.5 text-[12px]"
                    title="Remove the project default so analyses use the analyser's built-in default"
                >
                    Clear default
                </button>
                <span className="text-[12px] text-[color:var(--c-text-muted)]">
                    {!indexed
                        ? "Index this project first to set a default."
                        : current === ""
                            ? "No default set — analyses use the analyser's built-in default."
                            : "New analyses use this unless an issue overrides it."}
                </span>
            </div>

            {error && <p className="mt-3 text-[12px] text-rose-700">{error}</p>}
        </div>
    )
}

function GaugeIcon() {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z" />
            <path d="M12 12l4-3" />
            <path d="M5.5 18a9 9 0 1 1 13 0" />
        </svg>
    )
}
