"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { ISSUE_PRIORITIES, ISSUE_STATUSES } from "@/lib/supabase/types"
import type { IssuePriority, IssueStatus } from "@/lib/supabase/types"
import { Dropdown } from "@/components/dropdown"

const STATUS_OPTIONS = ISSUE_STATUSES.map((s) => ({ value: s, label: s.replace(/_/g, " ") }))
const PRIORITY_OPTIONS = ISSUE_PRIORITIES.map((p) => ({ value: p, label: p }))

interface IssueFormProps {
    projectId: string
    onSuccess?: () => void
    onCancel?: () => void
}

// Controlled form for creating an issue. The owner (modal wrapper, inline
// page section, etc.) supplies projectId and optional onSuccess /
// onCancel callbacks. The form does NOT manage its own open/close state.
export function IssueForm({ projectId, onSuccess, onCancel }: IssueFormProps) {
    const router = useRouter()
    const [title, setTitle] = useState("")
    const [body, setBody] = useState("")
    const [status, setStatus] = useState<IssueStatus>("open")
    const [priority, setPriority] = useState<IssuePriority>("medium")
    const [labels, setLabels] = useState("")
    const [error, setError] = useState<string | null>(null)
    const [pending, startTransition] = useTransition()

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
            router.refresh()
            onSuccess?.()
        })
    }

    return (
        <form onSubmit={submit} className="flex flex-col gap-3">
            <input
                autoFocus
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Issue title…"
                className="input text-[14px] font-semibold"
            />
            <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={5}
                placeholder="Describe what's happening (markdown supported)…"
                className="input text-[13px]"
            />
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
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
            {error && <p className="text-[12px] text-rose-700">{error}</p>}
            <div className="mt-1 flex justify-end gap-2">
                {onCancel && (
                    <button type="button" onClick={onCancel} className="btn-ghost">
                        Cancel
                    </button>
                )}
                <button type="submit" disabled={pending || !title.trim()} className="btn-primary">
                    {pending ? "Saving…" : "Create issue"}
                </button>
            </div>
        </form>
    )
}
