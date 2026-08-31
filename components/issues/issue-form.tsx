"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import type { IssuePriority, IssueStatus } from "@/lib/shared/types"
import { MarkdownEditor } from "@/components/markdown/markdown-editor"
import { useReadyBranches } from "@/components/projects/branch-picker"
import { branchChoicePending } from "@/components/issues/issue-branch-choice"
import { IssueEffortChip, IssueMetaBar } from "@/components/issues/issue-meta-bar"
import { AttachmentChips, MAX_ATTACHMENTS, isFileDrag, useIssueAttachments } from "@/components/issues/issue-attachments"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/components/ui/cn"
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

/** What /api/issues/ai-compose gives back that this form can use. The endpoint
 *  returns more (routing facets, usage, model) — none of it belongs in a text
 *  field, so it is deliberately not typed here. */
interface AiProposal {
    title: string
    body: string
    priority?: DraftPriority
    labels?: string[]
}

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

    // Screenshots for the AI draft pass. Not persisted with the draft — see
    // issue-attachments for why.
    const { images, addFiles, remove: removeImage, clear: clearImages, error: imageError } = useIssueAttachments()
    const [dropping, setDropping] = useState(false)
    const [drafting, setDrafting] = useState(false)
    const [draftError, setDraftError] = useState<string | null>(null)
    // Whether the AI produced what is currently in the form. Kept so the created
    // issue is still flagged ai_proposed, exactly as the old modal flagged it.
    const [aiProposed, setAiProposed] = useState(false)

    // There is something for the model to read: prose, or a screenshot.
    const canDraft = Boolean(title.trim() || body.trim() || images.length > 0)

    /** Hand the rough draft to the AI and let it fill the form in place.
     *
     *  This is the whole of what the separate compose modal used to do, minus
     *  the modal. It used to be a decision you made BEFORE writing anything —
     *  a different button, opening a different surface, with its own capture
     *  step that duplicated the composer's. Now you write whatever you have,
     *  drop in a screenshot, and press this; it reads the form and rewrites it.
     *
     *  It patches only what the model actually proposes. Branch is never touched
     *  — the model has no idea which tree you are working on, and that choice is
     *  required precisely because it is yours. */
    function draftWithAi() {
        if (!canDraft || drafting) return
        setDraftError(null)
        setDrafting(true)
        void (async () => {
            try {
                const { proposal } = await apiMutate<{ proposal?: AiProposal }>("/api/issues/ai-compose", {
                    method: "POST",
                    body: {
                        project_id: projectId,
                        // Title and body are one rough note as far as the model
                        // is concerned; it decides which parts become which.
                        paragraph: [title.trim(), body.trim()].filter(Boolean).join("\n\n"),
                        images: images.map((i) => i.dataUrl),
                    },
                })
                if (!proposal) {
                    // Reported, not thrown. This is a bad ANSWER, not a broken
                    // program, and throwing it from inside a detached async
                    // function only produced an unhandled rejection that the
                    // user never saw — the button just stopped spinning.
                    setDraftError("The draft came back empty. Try again, or add a bit more detail.")
                    return
                }
                patch({
                    title: proposal.title || title,
                    body: proposal.body || body,
                    ...(proposal.priority ? { priority: proposal.priority } : {}),
                    ...(proposal.labels?.length ? { labels: proposal.labels.join(", ") } : {}),
                })
                setAiProposed(true)
            } catch (e) {
                // Everything surfaces here. Elsewhere in this file a non-ApiError
                // is re-thrown as a programmer error, but this runs detached from
                // React's error boundary — a rethrow is an unhandled rejection and
                // a button that silently stops spinning.
                setDraftError(
                    e instanceof ApiError
                        ? e.message || `Couldn't draft (${e.status})`
                        : e instanceof Error
                          ? e.message
                          : "Couldn't draft that.",
                )
            } finally {
                setDrafting(false)
            }
        })()
    }

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
                        // Set when the AI wrote what is being submitted, so the
                        // list still shows its "AI" badge now that the drafting
                        // happens here instead of in a dedicated modal.
                        ai_proposed: aiProposed,
                        // Omit when "" so the issue inherits the project default.
                        analyse_effort: effort || undefined,
                        // Both "chosen: default" ("") and — for a project with
                        // no branches to choose from — "never asked" (null) go
                        // to the default tree, which is what an omitted branch
                        // has always meant.
                        branch: branch || undefined,
                    },
                })
                // The screenshots were input to the draft, not content of the
                // issue — once it is filed they have nothing left to do, and
                // keeping them would silently re-attach them to whatever is
                // composed next in the same session.
                clearImages()
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
        <form
            onSubmit={submit}
            // Drop a screenshot anywhere on the composer, not onto a designated
            // well. The thing you want to attach it to is the whole draft, and
            // making someone aim at a target is a step that buys nothing.
            onDragOver={(e) => {
                if (!isFileDrag(e)) return
                e.preventDefault()
                setDropping(true)
            }}
            onDragLeave={(e) => {
                if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
                setDropping(false)
            }}
            onDrop={(e) => {
                if (!isFileDrag(e)) return
                e.preventDefault()
                setDropping(false)
                void addFiles(e.dataTransfer.files)
            }}
            className={cn(
                "flex flex-col gap-3 rounded-[12px] transition-colors",
                dropping && "outline outline-2 outline-offset-4 outline-[color:var(--c-primary)]",
            )}
        >
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

            <AttachmentChips images={images} onRemove={removeImage} />
            {imageError && <p className="text-[11.5px] text-[color:var(--c-text-muted)]">{imageError}</p>}
            {draftError && <p className="text-[12px] text-rose-700">{draftError}</p>}
            {error && <p className="text-[12px] text-rose-700">{error}</p>}
            <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                {/* Beside the action it modifies: this is how hard the analyser
                    works on the investigation that Create kicks off, not a fact
                    about the issue. */}
                <IssueEffortChip value={effort} onChange={(v) => patch({ effort: v })} />

                <AttachButton onFiles={addFiles} disabled={images.length >= MAX_ATTACHMENTS} />

                {/* The whole of the old compose modal, as one button. It reads
                    what is already in the form rather than asking for the same
                    thing again in a different surface. */}
                <button
                    type="button"
                    onClick={draftWithAi}
                    disabled={!canDraft || drafting}
                    title={canDraft ? undefined : "Write a line or attach a screenshot first"}
                    className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--c-border)] bg-[color:var(--c-surface)] py-[5px] pl-2 pr-2.5 text-[12px] font-semibold text-[color:var(--c-text)] transition-colors hover:border-[color:var(--c-border-strong)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                    {drafting ? <Spinner /> : <SparkleIcon />}
                    {drafting ? "Drafting…" : "Draft with AI"}
                </button>

                <div className="ml-auto flex items-center gap-2">
                {onCancel && (
                    <button type="button" onClick={onCancel} className="btn-ghost">
                        Cancel
                    </button>
                )}
                <button type="submit" disabled={pending || !title.trim() || needsBranch} className="btn-primary">
                    {pending ? "Saving…" : submitLabel}
                </button>
                </div>
            </div>
        </form>
    )
}

/** The paperclip. A plain file input styled as a chip, because a screenshot is
 *  usually dragged in — this is the fallback for the times it isn't (a phone
 *  photo, a file manager that won't drag, a keyboard-only user). */
function AttachButton({
    onFiles,
    disabled,
}: {
    onFiles: (files: FileList | null) => void
    disabled?: boolean
}) {
    return (
        <label
            className={cn(
                "inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-dashed border-[color:var(--c-border-strong)] py-[5px] pl-2 pr-2.5 text-[12px] font-medium text-[color:var(--c-text-muted)] transition-colors hover:border-[color:var(--c-text-dim)] hover:text-[color:var(--c-text)]",
                disabled && "cursor-not-allowed opacity-50",
            )}
        >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M21.4 11.05 12.25 20.2a5.5 5.5 0 0 1-7.78-7.78l9.2-9.19a3.67 3.67 0 1 1 5.18 5.18l-9.2 9.2a1.83 1.83 0 1 1-2.6-2.6l8.5-8.48" />
            </svg>
            Screenshot
            <input
                type="file"
                accept="image/*"
                multiple
                disabled={disabled}
                onChange={(e) => {
                    onFiles(e.target.files)
                    // Reset so picking the SAME file twice still fires a change.
                    e.target.value = ""
                }}
                className="sr-only"
            />
        </label>
    )
}

function SparkleIcon() {
    return (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M12 2l1.7 5.3L19 9l-5.3 1.7L12 16l-1.7-5.3L5 9l5.3-1.7L12 2zm6 11l.9 2.6L21 16.5l-2.1.9L18 20l-.9-2.6L15 16.5l2.1-.9.9-2.5z" />
        </svg>
    )
}
