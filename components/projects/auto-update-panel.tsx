"use client"

import { useCallback, useEffect, useState } from "react"
import { cn } from "@/components/ui/cn"
import { createClient } from "@/lib/supabase/client"
import { ApiError, apiMutate } from "@/lib/platform/http/api-client"

// AutoUpdatePanel — the setup toggle for auto-indexing on push. When on, a push
// to the repo's default branch triggers an incremental graph update through the
// analyser's coalescing queue (ADR-0058). Reads/writes projects.auto_index_on_push
// (RLS-scoped, owner-only). Independent of GitHub issue/PR sync.
export function AutoUpdatePanel({ projectId }: { projectId: string }) {
    const [on, setOn] = useState<boolean | null>(null) // null = loading
    const [busy, setBusy] = useState(false)
    const [err, setErr] = useState<string | null>(null)

    const load = useCallback(async () => {
        const supabase = createClient()
        const { data } = await supabase
            .from("projects")
            .select("auto_index_on_push")
            .eq("id", projectId)
            .maybeSingle<{ auto_index_on_push: boolean }>()
        // Default to on for older rows the migration hasn't backfilled in this session.
        setOn(data?.auto_index_on_push ?? true)
    }, [projectId])

    useEffect(() => {
        // Wrapped in an async IIFE so state is only set after the awaited fetch,
        // never synchronously in the effect body (mirrors github-sync-panel).
        void (async () => {
            await load()
        })()
    }, [load])

    async function toggle() {
        if (on === null || busy) return
        const next = !on
        setErr(null)
        setBusy(true)
        setOn(next) // optimistic
        try {
            await apiMutate(`/api/projects/${projectId}`, {
                method: "PATCH",
                body: { auto_index_on_push: next },
            })
        } catch (e) {
            setOn(!next) // revert
            if (e instanceof ApiError) setErr(e.message || `Failed (${e.status})`)
            else setErr("Network error")
        } finally {
            setBusy(false)
        }
    }

    const loading = on === null

    return (
        <div className="rounded-[16px] border border-[color:var(--c-border)] bg-white p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-2.5">
                    <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-[10px] bg-[color:var(--c-surface-2)] text-[color:var(--c-text-muted)]">
                        <RefreshIcon />
                    </span>
                    <div>
                        <div className="flex items-center gap-2">
                            <span className="text-[14px] font-bold">Auto-update on push</span>
                            {!loading && (
                                <span
                                    className={cn(
                                        "rounded-full px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.08em]",
                                        on ? "bg-emerald-100 text-emerald-800" : "bg-zinc-100 text-zinc-600",
                                    )}
                                >
                                    {on ? "On" : "Off"}
                                </span>
                            )}
                        </div>
                        <p className="mt-1 max-w-prose text-[13px] text-[color:var(--c-text-muted)]">
                            When on, every push to your default branch refreshes the knowledge graph in the
                            background — the analyser re-indexes just what changed. Rapid pushes are coalesced
                            into a single update at the latest commit.
                        </p>
                    </div>
                </div>

                <Switch checked={!!on} disabled={loading || busy} onClick={toggle} label="Auto-update on push" />
            </div>

            <p className="mt-3 rounded-[10px] bg-[color:var(--c-surface-2)] px-3 py-2 text-[12px] text-[color:var(--c-text-muted)]">
                Needs the GitHub App connected (above) and the project indexed once. Until then, pushes are
                ignored — no error.
            </p>

            {err && <p className="mt-3 text-[12px] text-rose-700">{err}</p>}
        </div>
    )
}

// Switch — a compact accessible on/off control (role=switch), styled to the app.
function Switch({
    checked,
    disabled,
    onClick,
    label,
}: {
    checked: boolean
    disabled?: boolean
    onClick: () => void
    label: string
}) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            aria-label={label}
            disabled={disabled}
            onClick={onClick}
            className={cn(
                "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50",
                checked ? "bg-[color:var(--c-primary)]" : "bg-zinc-300",
            )}
        >
            <span
                className={cn(
                    "inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform",
                    checked ? "translate-x-[22px]" : "translate-x-[2px]",
                )}
            />
        </button>
    )
}

function RefreshIcon() {
    return (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
            <path d="M21 3v5h-5" />
            <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
            <path d="M3 21v-5h5" />
        </svg>
    )
}
