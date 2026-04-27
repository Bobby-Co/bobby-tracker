"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { ISSUE_PRIORITIES, ISSUE_STATUSES } from "@/lib/supabase/types"
import type { IssuePriority, IssueStatus } from "@/lib/supabase/types"
import { Dropdown } from "@/components/dropdown"

const STATUS_OPTIONS = ISSUE_STATUSES.map((s) => ({ value: s, label: s.replace(/_/g, " ") }))
const PRIORITY_OPTIONS = ISSUE_PRIORITIES.map((p) => ({ value: p, label: p }))

export function IssueForm({ projectId }: { projectId: string }) {
    const router = useRouter()
    const [open, setOpen] = useState(false)
    const [title, setTitle] = useState("")
    const [body, setBody] = useState("")
    const [status, setStatus] = useState<IssueStatus>("open")
    const [priority, setPriority] = useState<IssuePriority>("medium")
    const [labels, setLabels] = useState("")
    const [error, setError] = useState<string | null>(null)
    const [pending, startTransition] = useTransition()

    function reset() {
        setTitle("")
        setBody("")
        setStatus("open")
        setPriority("medium")
        setLabels("")
        setError(null)
    }

    function submit(e: React.FormEvent) {
        e.preventDefault()
        setError(null)
        startTransition(async () => {
            const res = await fetch("/api/issues", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    project_id: projectId,
                    title,
                    body,
                    status,
                    priority,
                    labels: labels.split(",").map((l) => l.trim()).filter(Boolean),
                }),
            })
            if (!res.ok) {
                const e = await res.json().catch(() => ({}))
                setError(e?.error?.message || `Failed (${res.status})`)
                return
            }
            reset()
            setOpen(false)
            router.refresh()
        })
    }

    if (!open) {
        return (
            <button onClick={() => setOpen(true)} className="btn-primary">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
                    <path d="M12 5v14M5 12h14" />
                </svg>
                New issue
            </button>
        )
    }

    return (
        <form
            onSubmit={submit}
            className="rounded-[16px] border border-[color:var(--c-border)] bg-white p-4 shadow-[var(--shadow-card)] anim-rise"
        >
            <input
                autoFocus
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Issue title…"
                className="input mb-2 text-[14px] font-semibold"
            />
            <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={4}
                placeholder="Describe what's happening (markdown supported)…"
                className="input text-[13px]"
            />
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                <Dropdown<IssueStatus>
                    value={status}
                    onChange={setStatus}
                    options={STATUS_OPTIONS}
                    aria-label="Status"
                />
                <Dropdown<IssuePriority>
                    value={priority}
                    onChange={setPriority}
                    options={PRIORITY_OPTIONS}
                    aria-label="Priority"
                />
                <input
                    value={labels}
                    onChange={(e) => setLabels(e.target.value)}
                    placeholder="bug, performance"
                    className="input"
                />
            </div>
            {error && <p className="mt-2 text-[12px] text-rose-700">{error}</p>}
            <div className="mt-3 flex justify-end gap-2">
                <button
                    type="button"
                    onClick={() => {
                        reset()
                        setOpen(false)
                    }}
                    className="btn-ghost"
                >
                    Cancel
                </button>
                <button type="submit" disabled={pending || !title.trim()} className="btn-primary">
                    {pending ? "Saving…" : "Create"}
                </button>
            </div>
        </form>
    )
}
