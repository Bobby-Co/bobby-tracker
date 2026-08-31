"use client"

import { useEffect, useLayoutEffect, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import type { IssuePriority, IssueStatus } from "@/lib/shared/types"
import { MarkdownEditor } from "@/components/markdown/markdown-editor"
import { useReadyBranches } from "@/components/projects/branch-picker"
import { branchChoicePending } from "@/components/issues/issue-branch-choice"
import { IssueEffortChip, IssueMetaBar } from "@/components/issues/issue-meta-bar"
import { AttachmentChips, MAX_ATTACHMENTS, isFileDrag, useIssueAttachments } from "@/components/issues/issue-attachments"
import { LiquidSplit } from "@/components/issues/liquid-split"
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
    // Bumped per successful rewrite so the editor replays its arrival
    // animation. Two drafts in a row are two events; a boolean could only
    // express the first.
    const [morphSignal, setMorphSignal] = useState(0)

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
                setMorphSignal((n) => n + 1)
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
            {/* The editor is the anchor for the AI affordance, so the button
                sits ON the thing it rewrites rather than in a toolbar that
                could be about anything. */}
            <div className="relative">
                <MarkdownEditor
                    value={body}
                    onChange={(v) => patch({ body: v })}
                    projectId={projectId}
                    minHeight={panel ? 280 : 160}
                    placeholder="Describe what's happening. Press Enter to render a block; right-click for formatting."
                    ariaLabel="Issue description"
                    thinking={drafting}
                    morphSignal={morphSignal}
                />
                <AiDraftDock
                    onDraft={draftWithAi}
                    onFiles={addFiles}
                    drafting={drafting}
                    canDraft={canDraft}
                    attachmentsFull={images.length >= MAX_ATTACHMENTS}
                />
            </div>

            <AttachmentChips images={images} onRemove={removeImage} />
            {imageError && <p className="text-[11.5px] text-[color:var(--c-text-muted)]">{imageError}</p>}
            {draftError && <p className="text-[12px] text-rose-700">{draftError}</p>}
            {error && <p className="text-[12px] text-rose-700">{error}</p>}
            <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                {/* Beside the action it modifies: this is how hard the analyser
                    works on the investigation that Create kicks off, not a fact
                    about the issue. */}
                <IssueEffortChip value={effort} onChange={(v) => patch({ effort: v })} />

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

/** The AI affordance, docked to the editor's bottom-right corner.
 *
 *  On the editor rather than in the footer because it acts on the DOCUMENT: a
 *  button in the row with Cancel and Create reads as another way to submit,
 *  and this rewrites what you are looking at.
 *
 *  ─── the eject ──────────────────────────────────────────────────────────
 *
 *  "Analyse image" starts hidden underneath "Draft with AI" and ejects to the
 *  LEFT, in two beats:
 *
 *    1. a CIRCLE — the icon alone — is thrown out on a curve that overshoots
 *       and settles, so it reads as launched rather than faded in;
 *    2. once it lands, it widens to admit its label. Right edge pinned, so it
 *       grows away from the button it came from and nothing it has already
 *       drawn ever moves.
 *
 *  Closing reverses the order: the label is swallowed first, then the circle is
 *  pulled back under the button. Playing both at once looks like a glitch.
 *
 *  The primary button does NOT move. An earlier pass gave it a recoil — equal
 *  and opposite, which looked good in isolation and was bad to use: the thing
 *  you were reaching for slid out from under the cursor at the exact moment
 *  hovering it made it move. A control the pointer is approaching stays put.
 *
 *  Both distances are MEASURED rather than guessed. The travel is the button's
 *  width (the pill's right edge lands a gap clear of its left edge) and the
 *  expanded width is the pill's own natural width — both differ per font and
 *  per translation, and a hard-coded pair would leave the circle overlapping
 *  the button or the label clipped.
 *
 *  Focus opens it too, so a keyboard user can reach a control they cannot
 *  hover. */
function AiDraftDock({
    onDraft,
    onFiles,
    drafting,
    canDraft,
    attachmentsFull,
}: {
    onDraft: () => void
    onFiles: (files: FileList | null) => void
    drafting: boolean
    canDraft: boolean
    attachmentsFull: boolean
}) {
    const [phase, setPhase] = useState<Phase>("idle")
    const [dims, setDims] = useState({ btn: 0, travel: 0, full: 0, height: 0 })
    const [plays, setPlays] = useState(0)
    const pillRef = useRef<HTMLLabelElement>(null)
    const btnRef = useRef<HTMLButtonElement>(null)
    const beat = useRef<ReturnType<typeof setTimeout> | null>(null)

    // Layout effect, not a plain one: this decides where two elements sit and
    // how wide one of them is. Read after paint, the first frame would show the
    // pill at its natural size sitting on top of the button.
    useLayoutEffect(() => {
        const btn = btnRef.current?.offsetWidth ?? 0
        const full = pillRef.current?.offsetWidth ?? 0
        const height = btnRef.current?.offsetHeight ?? 0
        if (btn > 0 && full > 0) setDims({ btn, travel: btn + GAP, full, height })
    }, [])

    useEffect(() => () => { if (beat.current) clearTimeout(beat.current) }, [])

    // ─── the choreography ───────────────────────────────────────────────────
    //
    //   split   the button's own skin goes transparent and the SVG blob takes
    //           its place, thinning at the waist until a ball pinches off the
    //           left end.
    //   open    the blob is dropped, the real pill appears where the ball
    //           ended and grows to admit its label.
    //
    // There WAS a beat before these two, where the button stretched left over
    // the ground the split would use. It was choppy, and it was redundant: the
    // blob's first frame is already the button's exact capsule — the ball
    // starts coincident with the left cap, so their union IS the button — and
    // the empty part of the viewBox is simply the space the ball flies into.
    // The stretch was animating toward a shape the SVG never draws.
    function openDock() {
        if (beat.current) clearTimeout(beat.current)
        if (phase !== "idle") return
        setPhase("split")
        setPlays((n) => n + 1)
        beat.current = setTimeout(() => setPhase("open"), SPLIT_MS)
    }

    function closeDock() {
        if (beat.current) clearTimeout(beat.current)
        // Straight back. Reversing the split would mean replaying it backwards
        // for a gesture nobody watches — a pointer leaving is already gone.
        setPhase("idle")
    }

    const splitting = phase === "split"
    const opened = phase === "open"
    const measured = dims.full > 0

    return (
        <div
            className="absolute bottom-2.5 right-2.5 flex items-center"
            onPointerEnter={openDock}
            onPointerLeave={closeDock}
            onFocus={openDock}
            onBlur={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) closeDock()
            }}
        >
            {/* The blob stands in for the button's skin for exactly one beat. */}
            {measured && dims.height > 0 && (
                <div
                    aria-hidden
                    className={cn(
                        "pointer-events-none absolute bottom-0 right-0 transition-opacity",
                        splitting ? "opacity-100 duration-0" : "opacity-0 duration-150",
                    )}
                >
                    <LiquidSplit
                        geo={{
                            width: dims.travel + CIRCLE,
                            height: dims.height,
                            capWidth: dims.travel - GAP,
                            ballRadius: CIRCLE / 2,
                        }}
                        playToken={plays}
                        durationMs={SPLIT_MS}
                    />
                </div>
            )}

            <label
                ref={pillRef}
                style={{
                    transform: opened ? `translateX(${-dims.travel}px)` : "translateX(0) scale(0.6)",
                    width: measured ? (opened ? dims.full : CIRCLE) : undefined,
                }}
                className={cn(
                    "absolute right-0 top-0 flex cursor-pointer items-center justify-center gap-1.5 overflow-hidden whitespace-nowrap rounded-full border border-[color:var(--c-border)] bg-[color:var(--c-surface)] py-[5px] text-[12px] font-medium text-[color:var(--c-text-muted)] shadow-[var(--shadow-pop)] hover:text-[color:var(--c-text)]",
                    "transition-[transform,width,opacity] duration-[240ms] [transition-timing-function:cubic-bezier(0.34,1.56,0.64,1),cubic-bezier(0.16,1,0.3,1),linear]",
                    opened ? "opacity-100" : "pointer-events-none opacity-0",
                    attachmentsFull && "cursor-not-allowed opacity-50",
                )}
            >
                <span className="grid h-3.5 w-3.5 shrink-0 place-items-center">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <rect x="3" y="4" width="18" height="16" rx="2.5" />
                        <circle cx="8.5" cy="9.5" r="1.6" />
                        <path d="M4 16.5 9 12l3.5 3 2.5-2 5 4.5" />
                    </svg>
                </span>
                <span className={cn("transition-opacity duration-150", !opened && "opacity-0")}>
                    Analyse image
                </span>
                <input
                    type="file"
                    accept="image/*"
                    multiple
                    disabled={attachmentsFull}
                    onChange={(e) => {
                        onFiles(e.target.files)
                        // Reset so picking the SAME file twice still fires.
                        e.target.value = ""
                    }}
                    className="sr-only"
                />
            </label>

            <button
                ref={btnRef}
                type="button"
                onClick={onDraft}
                disabled={!canDraft || drafting}
                title={canDraft ? undefined : "Write a line or attach a screenshot first"}
                className={cn(
                    "relative inline-flex items-center justify-end gap-1.5 whitespace-nowrap rounded-full py-[5px] pl-2.5 pr-3 text-[12px] font-semibold text-[color:var(--c-text)] shadow-[var(--shadow-pop)] disabled:cursor-not-allowed disabled:opacity-45",
                    // No width or padding here: the button never changes size.
                    // Only its skin hands over to the blob and comes back.
                    "transition-[background,border-color,opacity] duration-100 ease-out",
                    // Its skin is handed to the blob for the duration of the
                    // split and taken back afterwards.
                    splitting
                        ? "border border-transparent bg-transparent shadow-none"
                        : "border border-[color:var(--c-primary)] bg-[color:var(--c-primary-tint)] hover:bg-[color:var(--c-surface-2)]",
                )}
            >
                {drafting ? <Spinner /> : <SparkleIcon />}
                {drafting ? "Drafting…" : "Draft with AI"}
            </button>
        </div>
    )
}

type Phase = "idle" | "split" | "open"

/** How long the blob takes to pinch a ball off its left end. */
const SPLIT_MS = 240

/** Space between the pill and the button once the pill has landed. */
const GAP = 6
/** The pill before it opens: a circle holding just the icon. */
const CIRCLE = 28

function SparkleIcon() {
    return (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M12 2l1.7 5.3L19 9l-5.3 1.7L12 16l-1.7-5.3L5 9l5.3-1.7L12 2zm6 11l.9 2.6L21 16.5l-2.1.9L18 20l-.9-2.6L15 16.5l2.1-.9.9-2.5z" />
        </svg>
    )
}
