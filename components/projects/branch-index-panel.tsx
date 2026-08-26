"use client"

import { useEffect, useState } from "react"
import { cn } from "@/components/ui/cn"
import { MultiDropdown } from "@/components/ui/multi-dropdown"
import { FieldRow, FieldTable, MiniCard } from "@/components/ui/field-card"
import { useApi } from "@/lib/client/hooks/use-api"
import { ApiError, apiMutate } from "@/lib/client/http/api-client"
import type { ProjectBranch } from "@/lib/shared/types"

// BranchIndexPanel — the branches this project keeps indexed beyond its default.
//
// The default branch is deliberately not in this list. It is the project's own
// graph and it cannot be untracked, so showing it here would put a remove
// button next to the one row that has no remove.
//
// Indexing a branch copies the project's graph and replays that branch's parse
// over the copy, so it costs no model calls — but every tracked branch is
// resident in the analyser's memory, which is why this is an explicit list
// rather than "index everything".

const POLL_MS = 4_000

export function BranchIndexPanel({ projectId }: { projectId: string }) {
    // Poll while anything is mid-index: the analyser PATCHes the row directly
    // when the job lands, and this table is not on the realtime publication —
    // that carries only project_analyser, issue_suggestions and notifications.
    // Without a poll the row would sit at "Indexing…" until a manual refresh.
    //
    const [refreshMs, setRefreshMs] = useState<number | undefined>(undefined)
    const { data, refetch } = useApi<{ branches: ProjectBranch[] }>(
        `/api/projects/${projectId}/branches`,
        { refreshMs },
    )
    const branches = data?.branches ?? []
    const working = branches.some((b) => b.status === "indexing" || b.status === "pending")

    // State, not a derived value, and the lint rule below is suppressed
    // deliberately. The interval is an INPUT to the hook, read at the top of the
    // render that calls it — so a value derived after that call reaches the hook
    // no earlier than the next render, and there may not be one. Changing it has
    // to re-render to take effect, which is what setState is for. The same
    // pattern runs the pull-request page's poll.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(() => setRefreshMs(working ? POLL_MS : undefined), [working])

    // Every branch in the repository except the default one, with whether the
    // provider protects it. Live: branches come and go constantly and nothing
    // mirrors them, so a cache would offer dead branches and miss the one just
    // pushed — exactly when someone wants it indexed.
    const { data: avail, loading: listing, refetch: refetchAvailable } = useApi<{
        branches: { name: string; protected: boolean }[]
    }>(`/api/projects/${projectId}/branches/available`)
    const available = avail?.branches ?? []

    // What is tracked right now, and what the user has changed it to.
    //
    // Derived with an override rather than seeded in an effect: the default is a
    // pure function of data that arrives asynchronously, so an effect would mean
    // a render with the wrong value, then a correction — and the lint rule
    // against setState-in-effect is right about that one.
    const trackedNames = branches.map((b) => b.branch)
    const suggested = available.filter((b) => b.protected).map((b) => b.name)
    // Nothing tracked yet → suggest the protected branches. A protected branch
    // is one the team has already said matters, which beats "none" and beats
    // "all" — every tracked branch is resident in the analyser's memory.
    const defaultSelection = trackedNames.length > 0 ? trackedNames : suggested
    const [override, setOverride] = useState<string[] | null>(null)
    const selection = override ?? defaultSelection

    const toAdd = selection.filter((b) => !trackedNames.includes(b))
    const toRemove = trackedNames.filter((b) => !selection.includes(b))
    const dirty = toAdd.length > 0 || toRemove.length > 0

    const [adding, setAdding] = useState("")
    const [busy, setBusy] = useState<string | null>(null)
    const [err, setErr] = useState<string | null>(null)

    /** Make the tracked set match the selection.
     *
     *  Applied as a DIFF rather than a replace: an untrack drops the branch's
     *  graph, so re-tracking one that never changed would throw away a working
     *  index and pay to rebuild it.
     *
     *  Additions are tracked then indexed — two calls, because tracking records
     *  intent and cannot fail slowly, whereas indexing can (an unreachable cell,
     *  a repository with no graph yet) and needs somewhere to report it.
     *
     *  Sequential, not parallel: each addition is a clone plus a full graph copy
     *  on a shared, in-memory server, and firing eight at once is how you find
     *  that out the hard way. */
    async function applySelection() {
        if (!dirty || busy) return
        setErr(null)
        setBusy("apply")
        try {
            for (const branch of toRemove) {
                await apiMutate(`/api/projects/${projectId}/branches/${encodeURIComponent(branch)}`, {
                    method: "DELETE",
                })
            }
            for (const branch of toAdd) {
                await apiMutate(`/api/projects/${projectId}/branches`, {
                    method: "POST",
                    body: { branch },
                })
                await apiMutate(`/api/projects/${projectId}/branches/${encodeURIComponent(branch)}/index`, {
                    method: "POST",
                })
            }
            // Back to "the selection IS what is tracked", so the Apply button
            // settles rather than staying lit against a stale override.
            setOverride(null)
            await Promise.all([refetch(), refetchAvailable()])
        } catch (e) {
            setErr(e instanceof ApiError ? e.message || `Failed (${e.status})` : "Network error")
            await Promise.all([refetch(), refetchAvailable()])
        } finally {
            setBusy(null)
        }
    }

    async function track(e: React.FormEvent) {
        e.preventDefault()
        const branch = adding.trim()
        if (!branch || busy) return
        setErr(null)
        setBusy("add")
        try {
            await apiMutate(`/api/projects/${projectId}/branches`, {
                method: "POST",
                body: { branch },
            })
            setAdding("")
            await Promise.all([refetch(), refetchAvailable()])
            await index(branch)
        } catch (e) {
            setErr(e instanceof ApiError ? e.message || `Failed (${e.status})` : "Network error")
        } finally {
            setBusy(null)
        }
    }

    async function index(branch: string) {
        setErr(null)
        setBusy(branch)
        try {
            await apiMutate(`/api/projects/${projectId}/branches/${encodeURIComponent(branch)}/index`, {
                method: "POST",
            })
            await refetch()
        } catch (e) {
            setErr(e instanceof ApiError ? e.message || `Failed (${e.status})` : "Network error")
            await refetch()
        } finally {
            setBusy(null)
        }
    }

    async function untrack(branch: string) {
        if (busy) return
        setErr(null)
        setBusy(branch)
        try {
            await apiMutate(`/api/projects/${projectId}/branches/${encodeURIComponent(branch)}`, {
                method: "DELETE",
            })
            await Promise.all([refetch(), refetchAvailable()])
        } catch (e) {
            setErr(e instanceof ApiError ? e.message || `Failed (${e.status})` : "Network error")
        } finally {
            setBusy(null)
        }
    }

    return (
        <div className="rounded-[16px] border border-[color:var(--c-border)] bg-[color:var(--c-surface)] p-5">
            <div className="flex items-start gap-2.5">
                <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-[10px] bg-[color:var(--c-surface-2)] text-[color:var(--c-text-muted)]">
                    <BranchIcon />
                </span>
                <div className="min-w-0 flex-1">
                    <div className="text-[14px] font-bold">Indexed branches</div>
                    <p className="mt-1 text-[13px] leading-relaxed text-[color:var(--c-text-muted)]">
                        Ask questions against a branch as well as the default one. A branch reuses this
                        project&rsquo;s existing analysis, so indexing one spends no credits — it only
                        re-reads the branch&rsquo;s code, and stays current on every push.
                    </p>
                </div>
            </div>

            {branches.length > 0 && (
                // One CARD per indexed branch, not one row.
                //
                // Each branch is its own knowledge graph with its own freshness,
                // its own head, and its own id — the same facts the default
                // branch's panel shows about itself. A row could hold the name
                // and a status and nothing else, which quietly said a branch was
                // a lesser thing than the default. It is not; it is the same
                // thing, pointed at a different tree.
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    {branches.map((b) => (
                        <MiniCard
                            key={b.id}
                            tone={b.status === "failed" ? "rose" : b.status === "ready" ? "emerald" : "amber"}
                            interactive={false}
                            icon={<BranchIcon />}
                            title={<span className="font-mono text-[13px]">{b.branch}</span>}
                            badge={<StatusChip status={b.status} />}
                            footer={
                                <div className="flex items-center gap-1.5">
                                    <button
                                        type="button"
                                        onClick={() => index(b.branch)}
                                        disabled={busy !== null || b.status === "indexing"}
                                        className="cursor-pointer rounded-[8px] px-2 py-1 text-[12px] font-semibold text-[color:var(--c-text-muted)] hover:bg-[color:var(--c-surface-2)] hover:text-[color:var(--c-text)] disabled:cursor-not-allowed disabled:opacity-40"
                                    >
                                        {b.status === "ready" ? "Re-index" : "Index"}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => untrack(b.branch)}
                                        disabled={busy !== null}
                                        className="cursor-pointer rounded-[8px] px-2 py-1 text-[12px] font-semibold text-[color:var(--c-text-muted)] hover:bg-[color:var(--c-error-bg)] hover:text-[color:var(--c-error)] disabled:cursor-not-allowed disabled:opacity-40"
                                    >
                                        Remove
                                    </button>
                                </div>
                            }
                        >
                            <FieldTable>
                                <FieldRow label="Last indexed">
                                    {b.last_indexed_at ? new Date(b.last_indexed_at).toLocaleString() : "—"}
                                </FieldRow>
                                <FieldRow label="HEAD SHA">
                                    <code className="font-mono">{b.last_indexed_sha ? b.last_indexed_sha.slice(0, 7) : "—"}</code>
                                </FieldRow>
                                <FieldRow label="Graph ID">
                                    <code className="truncate font-mono">{b.graph_id || "—"}</code>
                                </FieldRow>
                            </FieldTable>
                            {b.status === "failed" && b.last_error && (
                                <p className="mt-2 text-[12px] leading-5 text-[color:var(--c-error)]">{b.last_error}</p>
                            )}
                        </MiniCard>
                    ))}
                </div>
            )}

            {available.length > 0 ? (
                <div className="mt-4 flex flex-wrap items-center gap-2">
                    {/* Pick the SET, not one at a time. Which branches are
                        indexed is a standing choice, so the control that
                        expresses it should be a selection you adjust — not a
                        queue you add to and a separate button you remove with. */}
                    <MultiDropdown
                        values={selection}
                        onChange={setOverride}
                        options={available.map((b) => ({
                            value: b.name,
                            label: b.name,
                            // Protected branches lead, and say why they lead.
                            group: b.protected ? "Protected" : "Other branches",
                        }))}
                        placeholder="No branches indexed"
                        searchable={available.length > 8}
                        aria-label="Branches to keep indexed"
                        className="min-w-0 flex-1"
                        disabled={busy !== null}
                    />
                    <button
                        type="button"
                        onClick={() => void applySelection()}
                        disabled={!dirty || busy !== null}
                        className="cursor-pointer rounded-[10px] bg-[color:var(--c-primary)] px-3.5 py-2 text-[12.5px] font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"
                    >
                        {busy === "apply" ? "Applying…" : "Apply"}
                    </button>
                </div>
            ) : (
                // No listing — no integration, or the provider refused. Typing
                // still works, because losing the convenience should not lose
                // the capability.
                <form onSubmit={track} className="mt-4 flex flex-wrap items-center gap-2">
                    <input
                        value={adding}
                        onChange={(e) => setAdding(e.target.value)}
                        placeholder={listing ? "loading branches…" : "feat/my-branch"}
                        spellCheck={false}
                        className="min-w-0 flex-1 rounded-[10px] border border-[color:var(--c-border)] bg-[color:var(--c-surface-2)] px-3 py-2 font-mono text-[12.5px] outline-none focus:border-[color:var(--c-primary)]"
                    />
                    <button
                        type="submit"
                        disabled={!adding.trim() || busy !== null}
                        className="cursor-pointer rounded-[10px] bg-[color:var(--c-primary)] px-3.5 py-2 text-[12.5px] font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"
                    >
                        {busy === "add" ? "Adding…" : "Track branch"}
                    </button>
                </form>
            )}

            {dirty && (
                <p className="mt-2 text-[12.5px] text-[color:var(--c-text-muted)]">
                    {toAdd.length > 0 && <>Will index {toAdd.join(", ")}. </>}
                    {toRemove.length > 0 && <>Will stop indexing {toRemove.join(", ")}.</>}
                </p>
            )}

            {err && <p className="mt-2 text-[12.5px] text-[color:var(--c-error)]">{err}</p>}
        </div>
    )
}

// Four states, and the one that matters is the difference between "ready" and
// everything else: a branch that is not ready cannot be queried, and the
// analyser says so rather than quietly answering about the default branch.
function StatusChip({ status }: { status: ProjectBranch["status"] }) {
    const tone =
        status === "ready"
            ? "bg-[color:var(--c-success-bg)] text-[color:var(--c-success)]"
            : status === "failed"
              ? "bg-[color:var(--c-error-bg)] text-[color:var(--c-error)]"
              : "bg-[color:var(--c-surface-2)] text-[color:var(--c-text-muted)]"
    const label =
        status === "ready" ? "Ready" : status === "failed" ? "Failed" : status === "indexing" ? "Indexing…" : "Queued"
    return (
        <span
            className={cn(
                "shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.08em]",
                tone,
            )}
        >
            {label}
        </span>
    )
}

function BranchIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
                d="M4.5 2.5v7m0 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm0-7a2 2 0 1 0 0-.001M11.5 4.5a2 2 0 1 0 0-.001M11.5 6.5c0 2-1.5 3-3.5 3.2"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    )
}
