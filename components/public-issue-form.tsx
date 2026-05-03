"use client"

import { useState, useTransition } from "react"
import { ISSUE_PRIORITIES } from "@/lib/supabase/types"
import type { IssuePriority } from "@/lib/supabase/types"
import { Dropdown } from "@/components/dropdown"

const PRIORITY_OPTIONS = ISSUE_PRIORITIES.map((p) => ({ value: p, label: p }))

// Anonymous issue submission form for /p/<token>. Posts to the public
// endpoint; on success swaps to a thank-you state with the assigned
// per-project issue number so the submitter can reference it later.
export function PublicIssueForm({ token }: { token: string }) {
    const [reporter, setReporter] = useState("")
    const [title, setTitle] = useState("")
    const [body, setBody] = useState("")
    const [priority, setPriority] = useState<IssuePriority>("medium")
    const [error, setError] = useState<string | null>(null)
    const [submitted, setSubmitted] = useState<{ issue_number: number } | null>(null)
    const [pending, startTransition] = useTransition()

    function submit(e: React.FormEvent) {
        e.preventDefault()
        setError(null)
        startTransition(async () => {
            const res = await fetch("/api/public-issues", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ token, reporter, title, body, priority }),
            })
            if (!res.ok) {
                const e = await res.json().catch(() => ({}))
                setError(e?.error?.message || `Failed (${res.status})`)
                return
            }
            const data = await res.json()
            setSubmitted({ issue_number: data.issue_number })
        })
    }

    function reset() {
        setSubmitted(null)
        setTitle("")
        setBody("")
        setPriority("medium")
    }

    if (submitted) {
        return (
            <div className="flex flex-col gap-3 rounded-[14px] border border-[color:var(--c-border)] bg-white p-5">
                <div className="text-[14px] font-bold">Thanks — issue #{submitted.issue_number} filed.</div>
                <p className="text-[13px] text-[color:var(--c-text-muted)]">
                    The maintainers will see it on their issue board. Reference the number above if you need to follow up.
                </p>
                <button type="button" onClick={reset} className="btn-ghost self-start">
                    Submit another
                </button>
            </div>
        )
    }

    return (
        <form onSubmit={submit} className="flex flex-col gap-3 rounded-[14px] border border-[color:var(--c-border)] bg-white p-5">
            <input
                value={reporter}
                onChange={(e) => setReporter(e.target.value)}
                placeholder="Your name (optional)"
                maxLength={80}
                className="input text-[13px]"
            />
            <input
                autoFocus
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="What's wrong, in one line…"
                className="input text-[14px] font-semibold"
            />
            <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={6}
                placeholder="Steps to reproduce, what you expected, what happened (markdown supported)…"
                className="input text-[13px]"
            />
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto] sm:items-center">
                <Dropdown<IssuePriority>
                    value={priority}
                    onChange={setPriority}
                    options={PRIORITY_OPTIONS}
                    aria-label="Priority"
                />
                <button type="submit" disabled={pending || !title.trim()} className="btn-primary">
                    {pending ? "Submitting…" : "Submit issue"}
                </button>
            </div>
            {error && <p className="text-[12px] text-rose-700">{error}</p>}
        </form>
    )
}
