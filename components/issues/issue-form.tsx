"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import type { IssuePriority, IssueStatus } from "@/lib/shared/types"
import { MarkdownEditor } from "@/components/markdown/markdown-editor"
import { useReadyBranches } from "@/components/projects/branch-picker"
import { branchChoicePending } from "@/components/issues/issue-branch-choice"
import { IssueMetaBar } from "@/components/issues/issue-meta-bar"
import { ApiError, apiMutate } from "@/lib/client/http/api-client"
import { EMPTY_DRAFT_FIELDS, type DraftFields, type DraftPriority, type DraftStatus } from "@/modules/issues/domain/IssueDraft"

// Drift guard: the draft's mirrored field unions (the domain layer can't import
// lib/shared) must stay identical to the real issue enums. If either side gains
// a value the other lacks, `Exact` collapses to `never` and this fails to build.
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never
const _statusInSync: Exact<DraftStatus, IssueStatus> = true
const _priorityInSync: Exact<DraftPriority, IssuePriority> = true
void _statusInSync
void _priorityInSync

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
    // Fetched ONCE here and passed down: the submit gate and the control need
    // the same list, and useApi does no dedup.
    const { ready: readyBranches, defaultBranch } = useReadyBranches(projectId)
    const needsBranch = branchChoicePending(readyBranches, branch)
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
                        // Both "chosen: default" ("") and — for a project with
                        // no branches to choose from — "never asked" (null) go
                        // to the default tree, which is what an omitted branch
                        // has always meant.
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
            {/* Under the title, ABOVE the description. These are decisions about
                the thing you are about to write, and the description is the tall
                element — anything below it is below the fold. */}
            <IssueMetaBar
                fields={fields}
                patch={patch}
                ready={readyBranches}
                defaultBranch={defaultBranch}
            />
            <MarkdownEditor
                value={body}
                onChange={(v) => patch({ body: v })}
                projectId={projectId}
                minHeight={panel ? 280 : 160}
                placeholder="Describe what's happening. Press Enter to render a block; right-click for formatting."
                ariaLabel="Issue description"
            />


            {error && <p className="text-[12px] text-rose-700">{error}</p>}
            <div className="mt-1 flex justify-end gap-2">
                {onCancel && (
                    <button type="button" onClick={onCancel} className="btn-ghost">
                        Cancel
                    </button>
                )}
                <button type="submit" disabled={pending || !title.trim() || needsBranch} className="btn-primary">
                    {pending ? "Saving…" : submitLabel}
                </button>
            </div>
        </form>
    )
}
