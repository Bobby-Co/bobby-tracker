"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { ISSUE_PRIORITIES, ISSUE_STATUSES } from "@/lib/supabase/types"
import type { Issue, IssuePriority, IssueStatus } from "@/lib/supabase/types"
import { PriorityChip, StatusChip } from "@/components/status-chip"
import { Dropdown } from "@/components/dropdown"

const STATUS_OPTIONS = ISSUE_STATUSES.map((s) => ({ value: s, label: s.replace(/_/g, " ") }))
const PRIORITY_OPTIONS = ISSUE_PRIORITIES.map((p) => ({ value: p, label: p }))

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
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_240px]">
            <article className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[12px] text-[color:var(--c-text-dim)]">#{issue.issue_number}</span>
                    <StatusChip status={issue.status} />
                    <PriorityChip priority={issue.priority} />
                </div>
                <h1 className="mt-2 text-[24px] font-extrabold leading-tight tracking-[-0.012em]">
                    {issue.title}
                </h1>
                <div className="mt-1 text-[12px] text-[color:var(--c-text-muted)]">
                    Updated {new Date(issue.updated_at).toLocaleString()}
                </div>

                <section className="mt-6 rounded-[16px] border border-[color:var(--c-border)] bg-white p-4 shadow-[var(--shadow-card)]">
                    <div className="mb-2 flex items-center justify-between">
                        <span className="h-section">Description</span>
                        {!editingBody && (
                            <button
                                onClick={() => setEditingBody(true)}
                                className="rounded-md px-2 py-1 text-[11.5px] font-semibold text-[color:var(--c-text-muted)] hover:bg-[color:var(--c-overlay)] hover:text-[color:var(--c-text)]"
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
                                className="input text-[13px]"
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
                        <pre className="whitespace-pre-wrap break-words font-sans text-[13px] leading-6 text-[color:var(--c-text)]">
                            {body || (
                                <span className="italic text-[color:var(--c-text-dim)]">
                                    No description yet.
                                </span>
                            )}
                        </pre>
                    )}
                </section>
            </article>

            <aside className="flex flex-col gap-4 text-sm lg:sticky lg:top-6 lg:self-start">
                <Field label="Status">
                    <Dropdown<IssueStatus>
                        value={issue.status}
                        onChange={(v) => patch({ status: v })}
                        options={STATUS_OPTIONS}
                        aria-label="Status"
                    />
                </Field>
                <Field label="Priority">
                    <Dropdown<IssuePriority>
                        value={issue.priority}
                        onChange={(v) => patch({ priority: v })}
                        options={PRIORITY_OPTIONS}
                        aria-label="Priority"
                    />
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
                        className="input text-[12.5px]"
                    />
                </Field>
            </aside>
        </div>
    )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <label className="flex flex-col gap-1.5">
            <span className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-[color:var(--c-text-muted)]">
                {label}
            </span>
            {children}
        </label>
    )
}
