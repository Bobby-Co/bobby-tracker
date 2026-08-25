"use client"

import { useParams } from "next/navigation"
import { useState } from "react"
import { useApi } from "@/lib/client/hooks/use-api"
import { ApiError, apiMutate } from "@/lib/client/http/api-client"
import { PrList, type PullRequestRow } from "@/components/pulls/pr-list"
import { SegBar } from "@/components/ui/field-card"
import { PullRequest as PullRequestEntity } from "@/modules/vcs/domain/PullRequest"

interface PullsView {
    pulls: PullRequestRow[]
    syncing: boolean
}

export default function PullsPage() {
    const { id } = useParams<{ id: string }>()
    const { data, loading, error, refetch } = useApi<PullsView>(`/api/projects/${id}/pulls`)
    const [syncing, setSyncing] = useState(false)

    async function sync() {
        setSyncing(true)
        try {
            try {
                await apiMutate(`/api/projects/${id}/pulls/sync`, { method: "POST" })
            } catch (e) {
                // A server error is ignored (the sync runs detached) — fall through
                // to the refetch, as before; only a network error skips it.
                if (!(e instanceof ApiError)) throw e
            }
            // The backfill runs detached; give it a moment, then refetch.
            await new Promise((r) => setTimeout(r, 1500))
            refetch()
        } finally {
            setSyncing(false)
        }
    }

    if (loading) {
        return (
            <div className="flex flex-col gap-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="skeleton h-4 w-32 rounded-[8px]" />
                    <div className="skeleton h-9 w-24 rounded-[12px]" />
                </div>
                <div className="skeleton h-5 w-16 rounded-[8px]" />
                <div className="flex flex-col gap-2">
                    {[0, 1, 2, 3].map((i) => (
                        <div key={i} className="skeleton h-12 w-full rounded-[12px]" />
                    ))}
                </div>
            </div>
        )
    }

    if (error) {
        return (
            <div className="flex flex-col gap-6">
                <div className="rounded-[12px] border border-rose-200 bg-rose-50 px-4 py-3 text-[12.5px] text-rose-800">{error}</div>
            </div>
        )
    }

    const pulls = data?.pulls ?? []
    const isClosed = (pr: PullRequestRow) => PullRequestEntity.of(pr).isClosed()
    const open = pulls.filter((pr) => !isClosed(pr))
    const closed = pulls.filter(isClosed)

    return (
        <div className="flex flex-col gap-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <div className="flex items-center gap-2.5">
                        <span className="text-[17px] font-extrabold tabular-nums tracking-[-0.01em]">
                            {closed.length}
                            <span className="text-[color:var(--c-text-dim)]"> / {pulls.length}</span>
                        </span>
                        <SegBar value={closed.length} total={Math.max(pulls.length, 1)} max={14} />
                    </div>
                    <span className="hidden h-4 w-px bg-[color:var(--c-border)] sm:block" />
                    <p className="text-[12px] text-[color:var(--c-text-muted)]">
                        <span className="font-semibold text-[color:var(--c-text)]">{open.length}</span> open ·{" "}
                        <span className="font-semibold text-[color:var(--c-text)]">{closed.length}</span> closed
                    </p>
                </div>
                <button
                    type="button"
                    onClick={sync}
                    disabled={syncing}
                    className="inline-flex items-center gap-1.5 rounded-[12px] border border-[color:var(--c-border)] bg-[color:var(--c-surface)] px-3 py-2 text-[12.5px] font-semibold text-[color:var(--c-text)] shadow-[var(--shadow-card)] transition-colors hover:bg-[color:var(--c-surface-2)] disabled:opacity-50"
                >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={syncing ? "animate-spin" : undefined}>
                        <path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6" />
                    </svg>
                    {syncing ? "Syncing…" : "Sync"}
                </button>
            </div>

            {data?.syncing && pulls.length === 0 ? (
                /* Built from the --c-warn token pair, not raw amber-*: the pair
                   inverts with the theme (tint+ink on light, ink+tint on dark),
                   where a literal amber-50 stays a cream card on the dark app. */
                <div className="rounded-[16px] border border-[color:var(--c-warn)]/25 bg-[color:var(--c-warn-bg)] px-4 py-8 text-center text-[13px] text-[color:var(--c-warn)]">
                    <p className="font-semibold">Syncing pull requests from GitHub…</p>
                    <p className="mt-1 text-[12.5px] text-[color:var(--c-text-muted)]">
                        This runs in the background. Give it a moment, then refresh.
                    </p>
                    <button
                        type="button"
                        onClick={refetch}
                        className="mt-3 inline-flex items-center rounded-[10px] bg-[color:var(--c-warn)] px-3 py-1.5 text-[12px] font-semibold text-[color:var(--c-warn-bg)] transition-opacity hover:opacity-90"
                    >
                        Refresh
                    </button>
                </div>
            ) : pulls.length === 0 ? (
                <div className="rounded-[16px] border border-dashed border-[color:var(--c-border)] bg-[color:var(--c-surface)] px-5 py-10 text-center text-[13px] text-[color:var(--c-text-muted)]">
                    No pull requests yet. Open one on GitHub, or hit Sync to pull existing history.
                </div>
            ) : (
                <>
                    <PullGroup title="Open" pulls={open} projectId={id} />
                    {closed.length > 0 && <PullGroup title="Closed" pulls={closed} projectId={id} muted />}
                </>
            )}
        </div>
    )
}

function PullGroup({
    title,
    pulls,
    projectId,
    muted,
}: {
    title: string
    pulls: PullRequestRow[]
    projectId: string
    muted?: boolean
}) {
    return (
        <section className={muted ? "opacity-90" : ""}>
            <div className="mb-3 flex items-center gap-2">
                <h2 className="h-section">{title}</h2>
                <span className="rounded-full bg-[color:var(--c-surface-2)] px-1.5 py-[1px] text-[11px] font-bold tabular-nums text-[color:var(--c-text-muted)]">
                    {pulls.length}
                </span>
            </div>
            {pulls.length === 0 ? (
                <div className="rounded-[16px] border border-dashed border-[color:var(--c-border)] bg-[color:var(--c-surface)] px-5 py-8 text-center text-[13px] text-[color:var(--c-text-muted)]">
                    No pull requests here.
                </div>
            ) : (
                <PrList projectId={projectId} pulls={pulls} muted={muted} />
            )}
        </section>
    )
}
