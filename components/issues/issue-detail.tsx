"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { ISSUE_PRIORITIES, ISSUE_STATUSES } from "@/lib/shared/types"
import type {
    Issue,
    IssuePriority,
    IssueStatus,
    ProjectLabelIcon,
    ProjectStatusColor,
} from "@/lib/shared/types"
import { PriorityChip, StatusChip } from "@/components/ui/status-chip"
import { DEFAULT_BRANCH_VALUE, branchOptions, useReadyBranches } from "@/components/projects/branch-picker"
import { ApiError, apiMutate } from "@/lib/client/http/api-client"
import { Dropdown } from "@/components/ui/dropdown"
import { LabelsEditor } from "@/components/issues/labels-editor"
import { TimelinePeek } from "@/components/timeline/timeline-peek"
import { MarkdownBody } from "@/components/markdown/markdown-body"
import { MarkdownEditor } from "@/components/markdown/markdown-editor"
import type { SignedEmbed, SignedEmbedMap } from "@/modules/embeds/domain/SignedEmbed"

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
    embeds,
    onBodySaved,
}: {
    issue: Issue
    /** Optional — when present, the aside renders a peek timeline
     *  card linking to the full timeline view. Omit on contexts
     *  that don't have project metadata to hand. */
    projectId?: string
    peekOthers?: Issue[]
    labelIcons?: ProjectLabelIcon[]
    statusColors?: ProjectStatusColor[]
    /** Zoo embeds referenced by this body, signed server-side for THIS render
     *  (see modules/embeds). Re-fetched with the issue, never cached here. */
    embeds?: SignedEmbedMap
    /** Called after the body is saved. Editing the body can introduce a new
     *  `zoo:` reference, and only the server can sign one — so the page has to
     *  re-fetch, or the new embed sits as a placeholder until a reload. */
    onBodySaved?: () => void
}) {
    const router = useRouter()
    const [editingBody, setEditingBody] = useState(false)
    const [body, setBody] = useState(issue.body || "")
    const [pending, startTransition] = useTransition()

    // Embeds inserted during THIS edit. The server signs what it found in the
    // saved body, so a reference the author just typed has no signed URL yet —
    // the picker already resolved one, so we keep it here and the body renders
    // correctly the moment it is saved, instead of showing a placeholder until
    // the re-fetch lands. Overlaid, never merged back: the server's map wins.
    const [inserted, setInserted] = useState<SignedEmbedMap>({})
    const shownEmbeds = useMemo(() => ({ ...inserted, ...embeds }), [inserted, embeds])

    /** Remember a freshly minted embed so the saved body renders it immediately.
     *  The editor writes the reference into the text itself. */
    function rememberEmbed(embed: SignedEmbed) {
        setInserted((m) => ({ ...m, [embed.embedId]: embed }))
    }

    function patch(values: Partial<Issue>, onSaved?: () => void, onError?: () => void) {
        startTransition(async () => {
            try {
                await apiMutate(`/api/issues/${issue.id}`, { method: "PATCH", body: values })
                router.refresh()
                onSaved?.()
            } catch (e) {
                if (!(e instanceof ApiError)) throw e
                // Server error: silently ignore, as before (no refresh) — unless
                // the caller cares, which the branch control does: without a
                // refresh the dropdown keeps showing a tree the issue was never
                // moved to, which is the one thing this control must not do.
                onError?.()
            }
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

                <section className="mt-6 rounded-[16px] border border-[color:var(--c-border)] bg-[color:var(--c-surface)] p-4 shadow-[var(--shadow-card)]">
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
                            <MarkdownEditor
                                value={body}
                                onChange={setBody}
                                projectId={projectId}
                                embeds={shownEmbeds}
                                onEmbedInserted={rememberEmbed}
                                ariaLabel="Issue description"
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
                                        patch({ body }, onBodySaved)
                                        setEditingBody(false)
                                    }}
                                    disabled={pending}
                                    className="btn-primary"
                                >
                                    {pending ? "Saving…" : "Save"}
                                </button>
                            </div>
                        </div>
                    ) : body ? (
                        <div className="prose-tracker text-[13px] leading-6 text-[color:var(--c-text)]">
                            <MarkdownBody embeds={shownEmbeds}>{body}</MarkdownBody>
                        </div>
                    ) : (
                        <p className="text-[13px] italic leading-6 text-[color:var(--c-text-dim)]">
                            No description yet.
                        </p>
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
                <BranchField
                    projectId={issue.project_id}
                    value={issue.branch ?? DEFAULT_BRANCH_VALUE}
                    // A rejected retarget (the branch stopped being ready
                    // between page load and this click) must not leave the
                    // control claiming a tree the server refused.
                    onChange={(branch) => patch({ branch: branch || null }, undefined, () => router.refresh())}
                />
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

// Which indexed tree this issue is about — and therefore which one the analyser
// investigates it against.
//
// Renders NOTHING until the project tracks a ready branch, which is every
// project until someone does: a control whose only option is the one you already
// have costs space and teaches nothing. Retargeting is a plain PATCH; the
// cached analysis is keyed by branch, so the next investigation runs against the
// new tree rather than replaying an answer about the old one.
function BranchField({
    projectId,
    value,
    onChange,
}: {
    projectId: string
    value: string
    onChange: (branch: string) => void
}) {
    const { ready, defaultBranch } = useReadyBranches(projectId)
    if (ready.length === 0) return null
    return (
        <Field label="Branch">
            <Dropdown
                value={value}
                onChange={onChange}
                options={branchOptions(ready, defaultBranch)}
                searchable={ready.length > 8}
                aria-label="Branch this issue is about"
            />
        </Field>
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
