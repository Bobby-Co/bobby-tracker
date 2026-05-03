"use client"

import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import type { ProjectPublicIntegration } from "@/lib/supabase/types"
import { Spinner } from "@/components/spinner"

// Owner-facing toggle for the public-submissions integration. Lives
// on the project's Integrations tab next to the "Sessions covering
// this project" summary. Disabling unlinks the project from any
// session it currently covers (the API does that in the same call)
// so an off-state is meaningfully off.
export function PublicIntegrationPanel({
    projectId,
    initial,
    coveringCount,
}: {
    projectId: string
    initial: ProjectPublicIntegration | null
    coveringCount: number
}) {
    const router = useRouter()
    const [enabled, setEnabled] = useState<boolean>(initial?.enabled ?? false)
    const [error, setError] = useState<string | null>(null)
    const [pending, startTransition] = useTransition()

    function toggle(next: boolean) {
        if (!next && coveringCount > 0) {
            const ok = confirm(
                `Disable public submissions? This will also remove the project from ${coveringCount} session${coveringCount === 1 ? "" : "s"} covering it.`,
            )
            if (!ok) return
        }
        setError(null)
        startTransition(async () => {
            const res = await fetch(`/api/projects/${projectId}/public-integration`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ enabled: next }),
            })
            if (!res.ok) {
                const body = await res.json().catch(() => ({}))
                setError(body?.error?.message || `Failed (${res.status})`)
                return
            }
            const { integration } = await res.json()
            setEnabled(!!integration?.enabled)
            // Server-rendered "Sessions covering this project" reflects
            // the unlink — refresh so the count drops to 0.
            router.refresh()
        })
    }

    return (
        <div className="rounded-[16px] border border-[color:var(--c-border)] bg-white p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        <div className="text-[14px] font-bold">Public submissions</div>
                        <span
                            className={
                                enabled
                                    ? "rounded-full bg-emerald-100 px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.08em] text-emerald-800"
                                    : "rounded-full bg-zinc-100 px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.08em] text-zinc-700"
                            }
                        >
                            {enabled ? "Enabled" : "Disabled"}
                        </span>
                    </div>
                    <p className="mt-1 text-[13px] text-[color:var(--c-text-muted)]">
                        Enable so this project can be added to a public submission session.
                        {!enabled && " Disabled projects can't be selected when creating or editing a session."}
                    </p>
                </div>
                <button
                    onClick={() => toggle(!enabled)}
                    disabled={pending}
                    className={enabled ? "btn-ghost" : "btn-primary"}
                >
                    {pending
                        ? (<><Spinner />{enabled ? "Disabling…" : "Enabling…"}</>)
                        : (enabled ? "Disable" : "Enable")}
                </button>
            </div>
            {error && (
                <p role="alert" className="mt-3 rounded-[10px] bg-rose-50 px-3 py-2 text-[12.5px] text-rose-800">
                    {error}
                </p>
            )}
        </div>
    )
}
