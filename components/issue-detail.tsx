"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { ISSUE_PRIORITIES, ISSUE_STATUSES } from "@/lib/supabase/types"
import type { Issue, IssuePriority, IssueStatus } from "@/lib/supabase/types"
import { PriorityChip, StatusChip } from "@/components/status-chip"

export function IssueDetail({ issue }: { issue: Issue }) {
    const router = useRouter()
    const [editingBody, setEditingBody] = useState(false)
    const [body, setBody] = useState(issue.body || "")
    const [pending, startTransition] = useTransition()

    function patch(values: Partial<Issue>) {
        startTransition(async () => {
            const res = await fetch(`/api/issues/${issue.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(values),
            })
            if (res.ok) router.refresh()
        })
    }

    return (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_220px]">
            <article className="min-w-0">
                <div className="flex items-center gap-3">
                    <span className="font-mono text-xs text-zinc-500">#{issue.issue_number}</span>
                    <StatusChip status={issue.status} />
                    <PriorityChip priority={issue.priority} />
                </div>
                <h1 className="mt-2 text-2xl font-semibold tracking-tight">{issue.title}</h1>
                <div className="mt-1 text-xs text-zinc-500">
                    Updated {new Date(issue.updated_at).toLocaleString()}
                </div>

                <section className="mt-6 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
                    <div className="mb-2 flex items-center justify-between">
                        <span className="text-xs font-medium uppercase tracking-wider text-zinc-500">Description</span>
                        {!editingBody && (
                            <button
                                onClick={() => setEditingBody(true)}
                                className="text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
                            >
                                Edit
                            </button>
                        )}
                    </div>
                    {editingBody ? (
                        <div className="flex flex-col gap-2">
                            <textarea
                                value={body}
                                onChange={(e) => setBody(e.target.value)}
                                rows={8}
                                className="input text-sm"
                                autoFocus
                            />
                            <div className="flex justify-end gap-2">
                                <button
                                    onClick={() => {
                                        setBody(issue.body || "")
                                        setEditingBody(false)
                                    }}
                                    className="btn-ghost"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={() => {
                                        patch({ body })
                                        setEditingBody(false)
                                    }}
                                    disabled={pending}
                                    className="btn-primary"
                                >
                                    {pending ? "Saving…" : "Save"}
                                </button>
                            </div>
                        </div>
                    ) : (
                        <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-6 text-zinc-700 dark:text-zinc-300">
                            {body || <span className="italic text-zinc-400">No description yet.</span>}
                        </pre>
                    )}
                </section>

                {/* Phase 3 will hook the analyser-suggestions panel in here. */}
            </article>

            <aside className="flex flex-col gap-4 text-sm">
                <Field label="Status">
                    <select
                        value={issue.status}
                        onChange={(e) => patch({ status: e.target.value as IssueStatus })}
                        className="input text-xs"
                    >
                        {ISSUE_STATUSES.map((s) => (
                            <option key={s} value={s}>
                                {s.replace(/_/g, " ")}
                            </option>
                        ))}
                    </select>
                </Field>
                <Field label="Priority">
                    <select
                        value={issue.priority}
                        onChange={(e) => patch({ priority: e.target.value as IssuePriority })}
                        className="input text-xs"
                    >
                        {ISSUE_PRIORITIES.map((p) => (
                            <option key={p} value={p}>
                                {p}
                            </option>
                        ))}
                    </select>
                </Field>
                <Field label="Labels">
                    <input
                        defaultValue={issue.labels.join(", ")}
                        onBlur={(e) =>
                            patch({
                                labels: e.target.value.split(",").map((l) => l.trim()).filter(Boolean),
                            })
                        }
                        placeholder="bug, performance"
                        className="input text-xs"
                    />
                </Field>
            </aside>
        </div>
    )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <label className="flex flex-col gap-1">
            <span className="text-xs font-medium uppercase tracking-wider text-zinc-500">{label}</span>
            {children}
        </label>
    )
}
