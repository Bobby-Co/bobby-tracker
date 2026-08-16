"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useApi } from "@/lib/client/hooks/use-api"
import { Modal } from "@/components/ui/modal"
import { ApiError, apiMutate } from "@/lib/client/http/api-client"

// DangerZonePanel — irreversible project teardown. Delete removes the project,
// its analyser knowledge graph, and every tracked issue/PR/review/comment (see
// DELETE /api/projects/[id]). Guarded by a type-the-name confirmation so it
// can't be triggered by a stray click.
//
// The name comes from GET /api/projects/[id], not from a browser Supabase read.
// It used to read `projects` directly with the anon key, which stopped returning
// anything the moment 0067 retired the tenant RLS policies — and because the
// confirmation requires `name.length > 0`, the delete button then stayed
// disabled no matter what was typed. Silent, and it looked like the typing was
// wrong rather than the read.
export function DangerZonePanel({ projectId }: { projectId: string }) {
    const router = useRouter()
    const { data } = useApi<{ project: { name: string } | null }>(`/api/projects/${projectId}`)
    const name = data?.project?.name ?? ""

    const [confirming, setConfirming] = useState(false)
    const [confirm, setConfirm] = useState("")
    const [busy, setBusy] = useState(false)
    const [err, setErr] = useState<string | null>(null)

    // Both sides trimmed: a trailing space picked up from a copy-paste of the
    // project name should not read as a mismatch.
    const armed = name.length > 0 && confirm.trim() === name.trim() && !busy

    function close() {
        if (busy) return
        setConfirming(false)
        setConfirm("")
        setErr(null)
    }

    async function destroy() {
        if (!armed) return
        setErr(null)
        setBusy(true)
        try {
            await apiMutate(`/api/projects/${projectId}`, { method: "DELETE" })
            // Gone — leave the (now-deleted) project's pages for the list.
            router.push("/projects")
            router.refresh()
        } catch (e) {
            setErr(e instanceof ApiError ? (e.message ?? "Couldn't delete project") : "Network error")
            setBusy(false)
        }
    }

    return (
        <section className="rounded-[16px] border border-rose-300 bg-rose-50/40 p-5 dark:border-rose-900/60 dark:bg-rose-950/20">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-2.5">
                    <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-[10px] bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-400">
                        <WarnIcon />
                    </span>
                    <div>
                        <div className="text-[14px] font-bold text-rose-700 dark:text-rose-400">Delete project</div>
                        <p className="mt-1 max-w-prose text-[13px] text-[color:var(--c-text-muted)]">
                            Permanently deletes this project, its knowledge graph on the analyser, and every
                            issue, pull request, review, and comment tracked here. This cannot be undone.
                        </p>
                    </div>
                </div>

                <button
                    type="button"
                    onClick={() => setConfirming(true)}
                    className="h-8 shrink-0 rounded-[8px] border border-rose-400 px-3 text-[12.5px] font-semibold text-rose-700 transition-colors hover:bg-rose-600 hover:text-white dark:border-rose-800 dark:text-rose-400 dark:hover:text-white"
                >
                    Delete project
                </button>
            </div>

            {/* The confirmation lives in its own modal rather than inline, to
                match team deletion: a type-to-confirm field sitting permanently
                in the page invites someone to fill it in while reading, and the
                consequences deserve a deliberate step that takes over the
                screen. */}
            <Modal
                open={confirming}
                onClose={close}
                title={name ? `Delete ${name}?` : "Delete project?"}
                description="This cannot be undone."
                size="sm"
            >
                <div className="flex flex-col gap-3">
                    <p className="text-[12.5px] leading-relaxed text-[color:var(--c-text-muted)]">
                        Deletes this project along with its issues, pull requests, reviews and comments, and
                        tears down its knowledge graph on the analyser.
                    </p>

                    <label className="flex flex-col gap-1">
                        <span className="text-[11.5px] text-[color:var(--c-text-muted)]">
                            Type <strong className="text-[color:var(--c-text)]">{name || "the project name"}</strong>{" "}
                            to confirm
                        </span>
                        <input
                            autoFocus
                            value={confirm}
                            onChange={(e) => setConfirm(e.target.value)}
                            disabled={busy || !name}
                            placeholder={name}
                            autoComplete="off"
                            className="input"
                        />
                    </label>

                    {/* Say so rather than presenting a field that can never arm.
                        Without this the modal looks ready and simply refuses. */}
                    {!name && (
                        <p className="text-[12px] text-[color:var(--c-text-muted)]">Loading the project name…</p>
                    )}

                    {err && <p className="text-[12.5px] text-rose-700 dark:text-rose-400">{err}</p>}

                    <div className="flex justify-end gap-2 pt-1">
                        <button
                            type="button"
                            onClick={close}
                            disabled={busy}
                            className="h-8 rounded-[8px] border border-[color:var(--c-border)] px-3 text-[12.5px]"
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            onClick={destroy}
                            disabled={!armed}
                            className="h-8 rounded-[8px] bg-rose-600 px-3 text-[12.5px] font-semibold text-white transition-opacity disabled:opacity-40"
                        >
                            {busy ? "Deleting…" : "Delete project"}
                        </button>
                    </div>
                </div>
            </Modal>
        </section>
    )
}

function WarnIcon() {
    return (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
            <path d="M12 9v4" />
            <path d="M12 17h.01" />
        </svg>
    )
}
