"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { ISSUE_PRIORITIES, ISSUE_STATUSES } from "@/lib/supabase/types"
import type { IssuePriority, IssueStatus } from "@/lib/supabase/types"

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
                New issue
            </button>
        )
    }

    return (
        <form
            onSubmit={submit}
            className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950"
        >
            <input
                autoFocus
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Title"
                className="input mb-2 text-sm font-medium"
            />
            <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={4}
                placeholder="Describe what's happening (markdown supported)…"
                className="input text-sm"
            />
            <div className="mt-3 flex flex-wrap items-center gap-2">
                <Select value={status} onChange={setStatus} options={ISSUE_STATUSES} />
                <Select value={priority} onChange={setPriority} options={ISSUE_PRIORITIES} />
                <input
                    value={labels}
                    onChange={(e) => setLabels(e.target.value)}
                    placeholder="bug, performance"
                    className="input flex-1 min-w-[8rem] text-xs"
                />
            </div>
            {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
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

function Select<T extends string>({
    value,
    onChange,
    options,
}: {
    value: T
    onChange: (v: T) => void
    options: readonly T[]
}) {
    return (
        <select
            value={value}
            onChange={(e) => onChange(e.target.value as T)}
            className="input text-xs"
        >
            {options.map((o) => (
                <option key={o} value={o}>
                    {o.replace(/_/g, " ")}
                </option>
            ))}
        </select>
    )
}
