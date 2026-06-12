"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Modal } from "@/components/modal"
import { Spinner } from "@/components/spinner"
import { RelayStatusDot } from "@/components/relay-status-dot"
import { RelayPairApprove } from "@/components/relay-pair-approve"

// Mirror of the frozen GET /api/relay/workers contract. Kept local —
// lib/relay.ts is owned by the backend agent and not imported here.
interface RelayModel {
    id: string
    supportsTools?: boolean
    contextWindow?: number
}
interface RelayWorker {
    id: string
    name: string
    endpoint: string | null
    models: RelayModel[]
    createdAt: string
    lastSeenAt: string | null
    online: boolean
    connectedSince: string | null
}

const POLL_MS = 5000

// Compact relative-time formatter ("just now", "3m ago", "2h ago",
// "5d ago"). Falls back to a date for anything older than a week.
function relativeTime(iso: string | null): string {
    if (!iso) return "never"
    const t = Date.parse(iso)
    if (Number.isNaN(t)) return "unknown"
    const diff = Date.now() - t
    if (diff < 0) return "just now"
    const s = Math.floor(diff / 1000)
    if (s < 45) return "just now"
    const m = Math.floor(s / 60)
    if (m < 60) return `${m}m ago`
    const h = Math.floor(m / 60)
    if (h < 24) return `${h}h ago`
    const d = Math.floor(h / 24)
    if (d < 7) return `${d}d ago`
    return new Date(t).toLocaleDateString()
}

export function RelayWorkersClient() {
    const [workers, setWorkers] = useState<RelayWorker[] | null>(null)
    const [loadError, setLoadError] = useState<string | null>(null)
    const [pairOpen, setPairOpen] = useState(false)
    // Rename + unlink targets are tracked by worker so the modals know
    // what they're acting on without prop-drilling per row.
    const [renameTarget, setRenameTarget] = useState<RelayWorker | null>(null)
    const [unlinkTarget, setUnlinkTarget] = useState<RelayWorker | null>(null)

    const refetch = useCallback(async () => {
        try {
            const res = await fetch("/api/relay/workers")
            if (!res.ok) {
                setLoadError(`Couldn't load workers (${res.status}).`)
                return
            }
            const data = await res.json().catch(() => ({}))
            setWorkers(Array.isArray(data?.workers) ? data.workers : [])
            setLoadError(null)
        } catch {
            setLoadError("Network error loading workers.")
        }
    }, [])

    // Mount + 5s poll. Refetch is stable so the interval is set up once.
    useEffect(() => {
        refetch()
        const id = setInterval(refetch, POLL_MS)
        return () => clearInterval(id)
    }, [refetch])

    return (
        <div className="flex flex-col gap-6">
            <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
                <div className="min-w-0">
                    <h1 className="h-page">Local models</h1>
                    <p className="mt-1 max-w-prose text-[13.5px] text-[color:var(--c-text-muted)]">
                        Link a Mac running the Bobby Relay app to power analysis with your own local LLM
                        (Ollama / OMLX). Your machine does the work — code never leaves it.
                    </p>
                </div>
                <button onClick={() => setPairOpen(true)} className="btn-primary self-start sm:self-auto">
                    <LinkIcon />
                    Link a device
                </button>
            </header>

            {loadError && (
                <p role="alert" className="rounded-[10px] bg-rose-50 px-3 py-2 text-[12.5px] text-rose-800">
                    {loadError}
                </p>
            )}

            {workers === null ? (
                <SkeletonRows />
            ) : workers.length === 0 ? (
                <EmptyState onLink={() => setPairOpen(true)} />
            ) : (
                <ul className="flex flex-col gap-3">
                    {workers.map((w) => (
                        <li key={w.id}>
                            <WorkerCard
                                worker={w}
                                onRename={() => setRenameTarget(w)}
                                onUnlink={() => setUnlinkTarget(w)}
                            />
                        </li>
                    ))}
                </ul>
            )}

            <Modal
                open={pairOpen}
                onClose={() => setPairOpen(false)}
                title="Link a device"
                description="Pair the Bobby Relay app running on your Mac."
                size="sm"
            >
                <RelayPairApprove
                    onDone={() => {
                        // Refetch so the new worker shows up once it
                        // connects. Leave the modal open on the success
                        // state so the user reads the confirmation.
                        refetch()
                    }}
                />
            </Modal>

            <RenameModal
                worker={renameTarget}
                onClose={() => setRenameTarget(null)}
                onSaved={() => { setRenameTarget(null); refetch() }}
            />

            <UnlinkModal
                worker={unlinkTarget}
                onClose={() => setUnlinkTarget(null)}
                onDone={() => { setUnlinkTarget(null); refetch() }}
            />
        </div>
    )
}

function WorkerCard({
    worker,
    onRename,
    onUnlink,
}: {
    worker: RelayWorker
    onRename: () => void
    onUnlink: () => void
}) {
    const shownModels = worker.models.slice(0, 6)
    const extra = worker.models.length - shownModels.length

    return (
        <div className="card flex flex-col gap-3">
            <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px] bg-[color:var(--c-surface-2)] text-[color:var(--c-text-muted)]">
                        <ChipIcon />
                    </span>
                    <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                            <span className="truncate text-[14px] font-bold">{worker.name}</span>
                            <button
                                type="button"
                                onClick={onRename}
                                aria-label={`Rename ${worker.name}`}
                                className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-[color:var(--c-text-dim)] transition-colors hover:bg-[color:var(--c-overlay)] hover:text-[color:var(--c-text)]"
                            >
                                <PencilIcon />
                            </button>
                        </div>
                        <div className="mt-0.5 flex items-center gap-2 text-[11.5px] text-[color:var(--c-text-dim)]">
                            <RelayStatusDot online={worker.online} />
                            <span aria-hidden>·</span>
                            <span className="tabular-nums">
                                {worker.online
                                    ? `connected ${relativeTime(worker.connectedSince)}`
                                    : `last seen ${relativeTime(worker.lastSeenAt)}`}
                            </span>
                        </div>
                    </div>
                </div>
                <button
                    type="button"
                    onClick={onUnlink}
                    className="btn-ghost shrink-0 px-2.5 py-1.5 text-[12px] text-rose-700 hover:bg-rose-50"
                >
                    Unlink
                </button>
            </div>

            {worker.endpoint && (
                <div className="rounded-[10px] border border-[color:var(--c-border)] bg-[color:var(--c-surface-2)] px-3 py-1.5 font-mono text-[11.5px] text-[color:var(--c-text-muted)] truncate">
                    {worker.endpoint}
                </div>
            )}

            <div className="flex flex-wrap items-center gap-1.5">
                {worker.models.length === 0 ? (
                    <span className="text-[12px] text-[color:var(--c-text-dim)]">No models reported yet.</span>
                ) : (
                    <>
                        {shownModels.map((m) => (
                            <span key={m.id} className="pill font-mono text-[11px]" title={m.id}>
                                {m.id}
                                {m.supportsTools && (
                                    <span
                                        className="text-[9.5px] font-bold uppercase tracking-[0.06em]"
                                        style={{ color: "var(--c-success)" }}
                                        title="Supports tool calls"
                                    >
                                        tools
                                    </span>
                                )}
                            </span>
                        ))}
                        {extra > 0 && (
                            <span className="pill text-[11px] text-[color:var(--c-text-muted)]">
                                +{extra} more
                            </span>
                        )}
                    </>
                )}
            </div>
        </div>
    )
}

function RenameModal({
    worker,
    onClose,
    onSaved,
}: {
    worker: RelayWorker | null
    onClose: () => void
    onSaved: () => void
}) {
    const [name, setName] = useState("")
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)

    // Reset the field whenever a different worker opens the modal.
    useEffect(() => {
        if (worker) {
            setName(worker.name)
            setError(null)
        }
    }, [worker])

    async function save() {
        if (!worker) return
        const trimmed = name.trim()
        if (!trimmed || trimmed === worker.name) { onClose(); return }
        setSaving(true)
        setError(null)
        try {
            const res = await fetch(`/api/relay/workers/${worker.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: trimmed }),
            })
            if (!res.ok) {
                const e = await res.json().catch(() => ({}))
                setError(e?.error?.message || `Couldn't rename (${res.status}).`)
                setSaving(false)
                return
            }
            onSaved()
        } catch {
            setError("Network error — try again.")
        } finally {
            setSaving(false)
        }
    }

    return (
        <Modal open={!!worker} onClose={onClose} title="Rename device" size="sm">
            <form onSubmit={(e) => { e.preventDefault(); save() }} className="flex flex-col gap-3">
                <label className="flex flex-col gap-1">
                    <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-[color:var(--c-text-muted)]">
                        Name
                    </span>
                    <input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        disabled={saving}
                        placeholder="My MacBook Pro"
                        className="input text-[13px]"
                        aria-label="Device name"
                    />
                </label>
                {error && (
                    <p role="alert" className="rounded-[10px] bg-rose-50 px-3 py-2 text-[12.5px] text-rose-800">
                        {error}
                    </p>
                )}
                <div className="flex justify-end gap-2">
                    <button type="button" onClick={onClose} disabled={saving} className="btn-ghost">
                        Cancel
                    </button>
                    <button type="submit" disabled={saving || !name.trim()} className="btn-primary">
                        {saving ? (<><Spinner />Saving…</>) : "Save"}
                    </button>
                </div>
            </form>
        </Modal>
    )
}

function UnlinkModal({
    worker,
    onClose,
    onDone,
}: {
    worker: RelayWorker | null
    onClose: () => void
    onDone: () => void
}) {
    const [working, setWorking] = useState(false)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => { if (worker) setError(null) }, [worker])

    async function revoke() {
        if (!worker) return
        setWorking(true)
        setError(null)
        try {
            const res = await fetch(`/api/relay/workers/${worker.id}/revoke`, { method: "POST" })
            if (!res.ok) {
                const e = await res.json().catch(() => ({}))
                setError(e?.error?.message || `Couldn't unlink (${res.status}).`)
                setWorking(false)
                return
            }
            onDone()
        } catch {
            setError("Network error — try again.")
        } finally {
            setWorking(false)
        }
    }

    return (
        <Modal open={!!worker} onClose={onClose} title="Unlink device" size="sm">
            <div className="flex flex-col gap-3">
                <p className="text-[13px] text-[color:var(--c-text-muted)]">
                    Unlink <span className="font-semibold text-[color:var(--c-text)]">{worker?.name}</span>? It will
                    disconnect immediately and stop powering analysis. You can re-pair it later from the relay app.
                </p>
                {error && (
                    <p role="alert" className="rounded-[10px] bg-rose-50 px-3 py-2 text-[12.5px] text-rose-800">
                        {error}
                    </p>
                )}
                <div className="flex justify-end gap-2">
                    <button type="button" onClick={onClose} disabled={working} className="btn-ghost">
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={revoke}
                        disabled={working}
                        className="btn-primary bg-rose-600 hover:bg-rose-700"
                    >
                        {working ? (<><Spinner />Unlinking…</>) : "Unlink"}
                    </button>
                </div>
            </div>
        </Modal>
    )
}

function EmptyState({ onLink }: { onLink: () => void }) {
    return (
        <div className="rounded-[16px] border border-dashed border-[color:var(--c-border)] bg-white px-5 py-16 text-center">
            <div className="mx-auto grid h-10 w-10 place-items-center rounded-[10px] bg-[color:var(--c-surface-2)] text-[color:var(--c-text-dim)]">
                <ChipIcon />
            </div>
            <p className="mt-3 text-[14px] font-semibold">No local models linked yet</p>
            <p className="mx-auto mt-1 max-w-sm text-[12.5px] text-[color:var(--c-text-muted)]">
                Run the Bobby Relay app on your Mac, then link it here to use your own Ollama or OMLX models.
            </p>
            <div className="mt-4 flex justify-center">
                <button onClick={onLink} className="btn-primary">
                    <LinkIcon />
                    Link a device
                </button>
            </div>
        </div>
    )
}

function SkeletonRows() {
    return (
        <ul className="flex flex-col gap-3" aria-busy>
            {[0, 1, 2].map((i) => (
                <li key={i} className="card flex flex-col gap-3">
                    <div className="flex items-center gap-2">
                        <div className="skeleton h-8 w-8 rounded-[9px]" />
                        <div className="flex flex-col gap-1.5">
                            <div className="skeleton h-3.5 w-40" />
                            <div className="skeleton h-2.5 w-28" />
                        </div>
                    </div>
                    <div className="skeleton h-7 w-full rounded-[10px]" />
                    <div className="flex gap-1.5">
                        <div className="skeleton h-5 w-20 rounded-full" />
                        <div className="skeleton h-5 w-24 rounded-full" />
                    </div>
                </li>
            ))}
        </ul>
    )
}

function ChipIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect x="7" y="7" width="10" height="10" rx="1.5" />
            <path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" />
        </svg>
    )
}

function PencilIcon() {
    return (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
        </svg>
    )
}

function LinkIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
        </svg>
    )
}
