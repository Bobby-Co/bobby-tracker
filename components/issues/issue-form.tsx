"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { ISSUE_PRIORITIES, ISSUE_STATUSES } from "@/lib/shared/types"
import type { IssuePriority, IssueStatus } from "@/lib/shared/types"
import { ProjectAnalyser } from "@/modules/analysis/domain/ProjectAnalyser"
import { EFFORT_LABEL, EFFORT_HINT } from "@/components/ui/effort-control"
import { Dropdown } from "@/components/ui/dropdown"
import { cn } from "@/components/ui/cn"
import { MarkdownEditor } from "@/components/markdown/markdown-editor"
import { BranchPicker } from "@/components/projects/branch-picker"
import { ApiError, apiMutate } from "@/lib/client/http/api-client"
import { EMPTY_DRAFT_FIELDS, type DraftEffort, type DraftFields, type DraftPriority, type DraftStatus } from "@/modules/issues/domain/IssueDraft"

// Drift guard: the draft's mirrored field unions (the domain layer can't import
// lib/shared) must stay identical to the real issue enums. If either side gains
// a value the other lacks, `Exact` collapses to `never` and this fails to build.
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never
const _statusInSync: Exact<DraftStatus, IssueStatus> = true
const _priorityInSync: Exact<DraftPriority, IssuePriority> = true
void _statusInSync
void _priorityInSync

const STATUS_OPTIONS = ISSUE_STATUSES.map((s) => ({ value: s, label: s.replace(/_/g, " ") }))
const PRIORITY_OPTIONS = ISSUE_PRIORITIES.map((p) => ({ value: p, label: p }))

const EFFORT_OPTIONS: { value: DraftEffort; label: string; description: string }[] = [
    { value: "", label: "Use project default", description: "Inherit the project's saved effort." },
    ...ProjectAnalyser.EFFORTS.map((level) => ({
        value: level,
        label: EFFORT_LABEL[level],
        description: EFFORT_HINT[level],
    })),
]

interface IssueFormProps {
    projectId: string
    onSuccess?: () => void
    onCancel?: () => void
    /** "panel" gives the composer more vertical room for the description — it is
     *  a full composition surface, not a quick modal field. */
    variant?: "modal" | "panel"
    /** Controlled mode: the owner (the draft-backed composer) holds the field
     *  values and receives every edit, so a draft can persist and re-open with
     *  what was typed. Omit both to run uncontrolled with local state (the group
     *  quick-create modal, which has nothing to persist). */
    value?: DraftFields
    onChange?: (patch: Partial<DraftFields>) => void
    /** Verb on the primary button — the composer labels it per its own flow. */
    submitLabel?: string
}

// Form for creating an issue. The owner (composer panel, modal wrapper, inline
// page section, etc.) supplies projectId and optional callbacks. The form does
// NOT manage its own open/close state, and can be either controlled (value +
// onChange, so its content lives in a persistable draft) or uncontrolled.
export function IssueForm({ projectId, onSuccess, onCancel, variant = "modal", value, onChange, submitLabel = "Create issue" }: IssueFormProps) {
    const panel = variant === "panel"
    const router = useRouter()
    // Controlled when the owner passes value+onChange; otherwise keep the fields
    // in local state so standalone callers work unchanged.
    const [localFields, setLocalFields] = useState<DraftFields>(EMPTY_DRAFT_FIELDS)
    const fields = value ?? localFields
    const patch = onChange ?? ((p: Partial<DraftFields>) => setLocalFields((f) => ({ ...f, ...p })))
    const { title, body, status, priority, labels, effort, branch } = fields
    const [advanced, setAdvanced] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [pending, startTransition] = useTransition()

    function submit(e: React.FormEvent) {
        e.preventDefault()
        setError(null)
        startTransition(async () => {
            try {
                const { issue } = await apiMutate<{ issue?: { id?: string } }>("/api/issues", {
                    method: "POST",
                    body: {
                        project_id: projectId,
                        title,
                        body,
                        status,
                        priority,
                        labels: labels.split(",").map((l) => l.trim()).filter(Boolean),
                        // Omit when "" so the issue inherits the project default.
                        analyse_effort: effort || undefined,
                        // Likewise: "" is the default tree, and the server reads
                        // an absent/blank branch as exactly that.
                        branch: branch || undefined,
                    },
                })
                onSuccess?.()
                // Land on the new issue's detail page so the suggestions panel
                // can auto-trigger investigation. Refresh the issues list too
                // so when the user navigates back it's already up to date.
                router.refresh()
                if (issue?.id) router.push(`/projects/${projectId}/issues/${issue.id}`)
            } catch (e) {
                if (!(e instanceof ApiError)) throw e
                setError(e.message || `Failed (${e.status})`)
            }
        })
    }

    return (
        <form onSubmit={submit} className="flex flex-col gap-3">
            <input
                autoFocus
                required
                value={title}
                onChange={(e) => patch({ title: e.target.value })}
                placeholder="Issue title…"
                className="input text-[14px] font-semibold"
            />
            <MarkdownEditor
                value={body}
                onChange={(v) => patch({ body: v })}
                projectId={projectId}
                minHeight={panel ? 280 : 160}
                placeholder="Describe what's happening. Press Enter to render a block; right-click for formatting."
                ariaLabel="Issue description"
            />
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <Dropdown
                    value={status}
                    onChange={(v) => patch({ status: v })}
                    options={STATUS_OPTIONS}
                    aria-label="Status"
                />
                <Dropdown
                    value={priority}
                    onChange={(v) => patch({ priority: v })}
                    options={PRIORITY_OPTIONS}
                    aria-label="Priority"
                />
                <input
                    value={labels}
                    onChange={(e) => patch({ labels: e.target.value })}
                    placeholder="bug, performance"
                    className="input"
                />
            </div>

            <div className="rounded-[10px] border border-[color:var(--c-border)]">
                <button
                    type="button"
                    onClick={() => setAdvanced((v) => !v)}
                    aria-expanded={advanced}
                    className="flex w-full items-center gap-1.5 px-3 py-2 text-[12px] font-semibold text-[color:var(--c-text-muted)] transition-colors hover:text-[color:var(--c-text)]"
                >
                    <svg
                        width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                        strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden
                        className={cn("transition-transform duration-200", advanced && "rotate-90")}
                    >
                        <path d="M9 6l6 6-6 6" />
                    </svg>
                    Advanced settings
                </button>
                {advanced && (
                    <div className="border-t border-[color:var(--c-border)] p-3">
                        <label className="text-[11px] font-bold uppercase tracking-[0.10em] text-[color:var(--c-text-dim)]">
                            Analyser effort
                        </label>
                        <div className="mt-1.5">
                            <Dropdown
                                value={effort}
                                onChange={(v) => patch({ effort: v })}
                                options={EFFORT_OPTIONS}
                                aria-label="Analyser effort"
                            />
                        </div>
                        <p className="mt-2 text-[11.5px] leading-4 text-[color:var(--c-text-muted)]">
                            {effort === ""
                                ? "Inherits this project's saved default. Higher effort makes the analyser dig deeper for a richer, more accurate analysis — slower and pricier."
                                : EFFORT_HINT[effort]}
                        </p>

                        {/* Renders nothing until the project tracks a ready
                            branch, which is every project until someone does —
                            so the section stays exactly as it was for them. */}
                        <BranchPicker
                            projectId={projectId}
                            value={branch}
                            onChange={(v) => patch({ branch: v })}
                            className="mt-3 flex-wrap"
                        />
                    </div>
                )}
            </div>

            {error && <p className="text-[12px] text-rose-700">{error}</p>}
            <div className="mt-1 flex justify-end gap-2">
                {onCancel && (
                    <button type="button" onClick={onCancel} className="btn-ghost">
                        Cancel
                    </button>
                )}
                <button type="submit" disabled={pending || !title.trim()} className="btn-primary">
                    {pending ? "Saving…" : submitLabel}
                </button>
            </div>
        </form>
    )
}
