"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { ISSUE_PRIORITIES, ISSUE_STATUSES } from "@/lib/supabase/types"
import type {
    Issue,
    IssuePriority,
    IssueStatus,
    ProjectLabelIcon,
    ProjectStatusColor,
} from "@/lib/supabase/types"
import { PriorityChip, StatusChip } from "@/components/status-chip"
import { Dropdown } from "@/components/dropdown"
import { LabelsEditor } from "@/components/labels-editor"
import { TimelinePeek } from "@/components/timeline-peek"

const STATUS_OPTIONS = ISSUE_STATUSES.map((s) => ({ value: s, label: s.replace(/_/g, " ") }))
const PRIORITY_OPTIONS = ISSUE_PRIORITIES.map((p) => ({ value: p, label: p }))

// Pinned to en-US so the server (Node, often en-US default) and
// client (browser, user locale) render the same string.
//
// We format date and time separately and join with a literal
// ", " because Node and Chrome ship different CLDR versions and
// disagree on the joiner ("May 8, 2026, 01:50" vs "May 8, 2026
// at 01:50"). Splitting + manual join sidesteps that drift.
const UPDATED_DATE_FMT = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
})
const UPDATED_TIME_FMT = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
})
function formatUpdated(d: Date): string {
    return `${UPDATED_DATE_FMT.format(d)}, ${UPDATED_TIME_FMT.format(d)}`
}

export function IssueDetail({
    issue,
    projectId,
    peekOthers = [],
    labelIcons = [],
    statusColors = [],
}: {
    issue: Issue
    /** Optional — when present, the aside renders a peek timeline
     *  card linking to the full timeline view. Omit on contexts
     *  that don't have project metadata to hand. */
    projectId?: string
    peekOthers?: Issue[]
    labelIcons?: ProjectLabelIcon[]
    statusColors?: ProjectStatusColor[]
}) {
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
                    Updated {formatUpdated(new Date(issue.updated_at))}
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
                    <LabelsEditor
                        value={issue.labels}
                        labelIcons={labelIcons}
                        projectId={projectId}
                        onChange={(labels) => patch({ labels })}
                    />
                </Field>
                {projectId && (
                    <TimelinePeek
                        projectId={projectId}
                        issue={issue}
                        others={peekOthers}
                        labelIcons={labelIcons}
                        statusColors={statusColors}
                    />
                )}
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
