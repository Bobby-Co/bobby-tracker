"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"

// DangerZonePanel — irreversible project teardown. Delete removes the project,
// its analyser knowledge graph, and every tracked issue/PR/review/comment (see
// DELETE /api/projects/[id]). Guarded by a type-the-name confirmation so it
// can't be triggered by a stray click.
export function DangerZonePanel({ projectId }: { projectId: string }) {
    const router = useRouter()
    const [name, setName] = useState("")
    const [armed, setArmed] = useState(false)
    const [confirm, setConfirm] = useState("")
    const [busy, setBusy] = useState(false)
    const [err, setErr] = useState<string | null>(null)

    useEffect(() => {
        let cancelled = false
        void (async () => {
            const supabase = createClient()
            const { data } = await supabase
                .from("projects")
                .select("name")
                .eq("id", projectId)
                .maybeSingle<{ name: string }>()
            if (!cancelled) setName(data?.name ?? "")
        })()
        return () => {
            cancelled = true
        }
    }, [projectId])

    const match = confirm.trim() === name.trim() && name.length > 0
    const canDelete = armed && match && !busy

    async function del() {
        if (!canDelete) return
        setErr(null)
        setBusy(true)
        try {
            const res = await fetch(`/api/projects/${projectId}`, { method: "DELETE" })
            if (!res.ok && res.status !== 204) {
                const body = await res.json().catch(() => ({}))
                setErr(body?.error?.message || `Failed (${res.status})`)
                setBusy(false)
                return
            }
            // Gone — leave the (now-deleted) project's pages for the list.
            router.push("/projects")
            router.refresh()
        } catch {
            setErr("Network error")
            setBusy(false)
        }
    }

    return (
        <div className="rounded-[16px] border border-rose-200 bg-rose-50/50 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-2.5">
                    <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-[10px] bg-rose-100 text-rose-700">
                        <WarnIcon />
                    </span>
                    <div>
                        <div className="text-[14px] font-bold text-rose-900">Delete project</div>
                        <p className="mt-1 max-w-prose text-[13px] text-rose-800/80">
                            Permanently deletes this project, its knowledge graph on the analyser, and every
                            issue, pull request, review, and comment tracked here. This cannot be undone.
                        </p>
                    </div>
                </div>

                {!armed && (
                    <button
                        type="button"
                        onClick={() => setArmed(true)}
                        className="shrink-0 rounded-[10px] border border-rose-300 bg-white px-3.5 py-2 text-[12.5px] font-semibold text-rose-700 transition-colors hover:bg-rose-100"
                    >
                        Delete project
                    </button>
                )}
            </div>

            {armed && (
                <div className="mt-4 rounded-[12px] border border-rose-200 bg-white p-4">
                    <label className="flex flex-col gap-1.5">
                        <span className="text-[12.5px] text-[color:var(--c-text)]">
                            Type <span className="font-mono font-semibold">{name || "the project name"}</span> to confirm
                        </span>
                        <input
                            value={confirm}
                            onChange={(e) => setConfirm(e.target.value)}
                            autoFocus
                            placeholder={name}
                            className="w-full max-w-sm rounded-[10px] border border-rose-200 bg-white px-3 py-2 text-[13px] outline-none focus:border-rose-400"
                        />
                    </label>

                    <div className="mt-3 flex items-center gap-2">
                        <button
                            type="button"
                            onClick={del}
                            disabled={!canDelete}
                            className="rounded-[10px] bg-rose-600 px-3.5 py-2 text-[12.5px] font-semibold text-white transition-colors hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                            {busy ? "Deleting…" : "Delete permanently"}
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                setArmed(false)
                                setConfirm("")
                                setErr(null)
                            }}
                            disabled={busy}
                            className="rounded-[10px] px-3.5 py-2 text-[12.5px] font-semibold text-[color:var(--c-text-muted)] hover:text-[color:var(--c-text)] disabled:opacity-50"
                        >
                            Cancel
                        </button>
                    </div>

                    {err && <p className="mt-3 text-[12px] text-rose-700">{err}</p>}
                </div>
            )}
        </div>
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
