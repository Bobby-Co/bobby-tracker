"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { Modal } from "@/components/modal"
import { Spinner } from "@/components/spinner"
import { Dropdown } from "@/components/dropdown"
import { compressImage, type CompressedImage } from "@/lib/image-compress"
import { ISSUE_PRIORITIES, type IssuePriority } from "@/lib/supabase/types"

interface SimilarIssue {
    id: string
    issue_number: number
    title: string
    status: string
    similarity: number
}

interface IssueProposal {
    title: string
    body: string
    priority: IssuePriority
    labels: string[]
    confidence: "low" | "medium" | "high"
}

const PRIORITY_OPTIONS = ISSUE_PRIORITIES.map((p) => ({ value: p, label: p }))
const MAX_IMAGES = 6

// Triggered from the issues list. Two-step modal:
//
//   1. Capture: paragraph + images. Submit calls /api/issues/ai-compose
//      which returns a structured draft.
//
//   2. Review: pre-filled editable form + a "looks similar" panel
//      driven by /api/issues/ai-similar. The user either confirms to
//      create a fresh issue, or files this one linked as a duplicate
//      of an existing issue (still persisted, but flagged).
//
// All AI work is server-side; the only client-side cost is image
// compression (canvas resize → JPEG) before the bytes leave the
// browser, keeping API payloads small.
export function AiComposeButton({
    projectId,
    disabled,
    disabledReason,
}: {
    projectId: string
    disabled?: boolean
    disabledReason?: string
}) {
    const [open, setOpen] = useState(false)
    return (
        <>
            <button
                type="button"
                onClick={() => setOpen(true)}
                disabled={disabled}
                title={disabled ? disabledReason : undefined}
                aria-disabled={disabled}
                className="inline-flex items-center gap-1.5 rounded-[10px] border border-[color:var(--c-border)] bg-white px-3 py-1.5 text-[12.5px] font-semibold text-[color:var(--c-text)] transition-colors hover:border-[color:var(--c-border-strong)] disabled:cursor-not-allowed disabled:opacity-50"
            >
                <SparkleIcon />
                AI compose
            </button>
            <Modal
                open={open}
                onClose={() => setOpen(false)}
                title="Compose with AI"
                description="Describe what's wrong (or paste a screenshot). The model drafts a clean issue you can edit before saving."
                size="lg"
            >
                <AiComposeBody
                    projectId={projectId}
                    onClose={() => setOpen(false)}
                />
            </Modal>
        </>
    )
}

function AiComposeBody({ projectId, onClose }: { projectId: string; onClose: () => void }) {
    const router = useRouter()
    const [paragraph, setParagraph] = useState("")
    const [images, setImages] = useState<CompressedImage[]>([])
    const [imageError, setImageError] = useState<string | null>(null)
    const [composeError, setComposeError] = useState<string | null>(null)
    const [composing, setComposing] = useState(false)
    const [proposal, setProposal] = useState<IssueProposal | null>(null)
    const [similar, setSimilar] = useState<SimilarIssue[] | null>(null)
    const [similarLoading, setSimilarLoading] = useState(false)
    const [creating, startCreate] = useTransition()
    const [createError, setCreateError] = useState<string | null>(null)

    // Fetch similar issues for a fresh draft. We don't gate the
    // review UI on this — the form is editable immediately and the
    // panel pops in when the embedding lookup returns.
    async function loadSimilar(p: IssueProposal) {
        setSimilarLoading(true)
        try {
            const res = await fetch("/api/issues/ai-similar", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    project_id: projectId,
                    title: p.title,
                    body: p.body,
                    limit: 5,
                }),
            })
            if (!res.ok) { setSimilar([]); return }
            const data = await res.json()
            setSimilar(Array.isArray(data.similar) ? data.similar : [])
        } catch {
            setSimilar([])
        } finally {
            setSimilarLoading(false)
        }
    }

    async function handleFiles(fileList: FileList | null) {
        if (!fileList) return
        setImageError(null)
        const files = Array.from(fileList).filter((f) => f.type.startsWith("image/"))
        const room = MAX_IMAGES - images.length
        if (files.length > room) {
            setImageError(`Only ${MAX_IMAGES} images allowed — keeping the first ${room}.`)
        }
        const accepted = files.slice(0, room)
        try {
            const compressed = await Promise.all(accepted.map((f) => compressImage(f)))
            setImages((cur) => [...cur, ...compressed])
        } catch (e) {
            setImageError(e instanceof Error ? e.message : "Couldn't process one of the images.")
        }
    }

    function removeImage(idx: number) {
        setImages((cur) => cur.filter((_, i) => i !== idx))
    }

    async function compose() {
        setComposeError(null)
        setComposing(true)
        try {
            const res = await fetch("/api/issues/ai-compose", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    project_id: projectId,
                    paragraph,
                    images: images.map((i) => i.dataUrl),
                }),
            })
            if (!res.ok) {
                const e = await res.json().catch(() => ({}))
                setComposeError(e?.error?.message || `Failed (${res.status})`)
                return
            }
            const data = await res.json()
            const p = data.proposal as IssueProposal
            setProposal(p)
            void loadSimilar(p)
        } catch (e) {
            setComposeError(e instanceof Error ? e.message : String(e))
        } finally {
            setComposing(false)
        }
    }

    function backToCapture() {
        setProposal(null)
        setSimilar(null)
    }

    function createIssue(opts: { duplicateOf?: SimilarIssue } = {}) {
        if (!proposal) return
        setCreateError(null)
        startCreate(async () => {
            const res = await fetch("/api/issues", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    project_id: projectId,
                    title: proposal.title,
                    body: proposal.body,
                    priority: proposal.priority,
                    labels: proposal.labels,
                    ai_proposed: true,
                    duplicate_of_issue_id: opts.duplicateOf?.id ?? null,
                }),
            })
            if (!res.ok) {
                const e = await res.json().catch(() => ({}))
                setCreateError(e?.error?.message || `Failed (${res.status})`)
                return
            }
            const { issue } = await res.json()
            onClose()
            router.refresh()
            // If they marked it as a duplicate, send them to the
            // original — that's what they care about. Otherwise to
            // the new issue's detail page so suggestions can auto-fire.
            const target = opts.duplicateOf?.id ?? issue?.id
            if (target) router.push(`/projects/${projectId}/issues/${target}`)
        })
    }

    if (!proposal) {
        return (
            <CaptureStep
                paragraph={paragraph}
                setParagraph={setParagraph}
                images={images}
                onFiles={handleFiles}
                onRemoveImage={removeImage}
                imageError={imageError}
                onCancel={onClose}
                onCompose={compose}
                composing={composing}
                composeError={composeError}
            />
        )
    }

    return (
        <ReviewStep
            proposal={proposal}
            setProposal={setProposal}
            similar={similar}
            similarLoading={similarLoading}
            onBack={backToCapture}
            onCreate={() => createIssue()}
            onMarkDuplicate={(d) => createIssue({ duplicateOf: d })}
            creating={creating}
            createError={createError}
        />
    )
}

function CaptureStep({
    paragraph, setParagraph,
    images, onFiles, onRemoveImage,
    imageError,
    onCancel, onCompose, composing, composeError,
}: {
    paragraph: string
    setParagraph: (v: string) => void
    images: CompressedImage[]
    onFiles: (fl: FileList | null) => void
    onRemoveImage: (idx: number) => void
    imageError: string | null
    onCancel: () => void
    onCompose: () => void
    composing: boolean
    composeError: string | null
}) {
    const canCompose = !composing && (paragraph.trim().length > 0 || images.length > 0)
    return (
        <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1">
                <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-[color:var(--c-text-muted)]">
                    What&apos;s wrong?
                </span>
                <textarea
                    autoFocus
                    rows={6}
                    disabled={composing}
                    value={paragraph}
                    onChange={(e) => setParagraph(e.target.value)}
                    placeholder="Describe what you saw, what you expected, steps to reproduce — whatever you've got. The AI will tidy it up."
                    className="input text-[13px] leading-relaxed"
                />
            </label>

            <div className="flex flex-col gap-1.5">
                <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-[color:var(--c-text-muted)]">
                    Screenshots <span className="font-medium normal-case tracking-normal text-[color:var(--c-text-dim)]">(optional, up to {MAX_IMAGES})</span>
                </span>

                {images.length > 0 && (
                    <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                        {images.map((img, idx) => (
                            <li key={idx} className="group relative">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                    src={img.dataUrl}
                                    alt={`screenshot ${idx + 1}`}
                                    className="aspect-[4/3] w-full rounded-[10px] border border-[color:var(--c-border)] object-cover"
                                />
                                <button
                                    type="button"
                                    onClick={() => onRemoveImage(idx)}
                                    disabled={composing}
                                    aria-label={`Remove image ${idx + 1}`}
                                    className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-zinc-900/80 text-white opacity-0 transition-opacity group-hover:opacity-100"
                                >
                                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden>
                                        <path d="M6 6l12 12M18 6L6 18" />
                                    </svg>
                                </button>
                                <div className="mt-1 text-[10.5px] tabular-nums text-[color:var(--c-text-dim)]">
                                    {Math.round(img.bytes / 1024)} kB
                                </div>
                            </li>
                        ))}
                    </ul>
                )}

                <label
                    className={
                        "flex cursor-pointer items-center justify-center gap-2 rounded-[12px] border border-dashed border-[color:var(--c-border)] bg-[color:var(--c-surface-2)] px-3 py-4 text-[12.5px] text-[color:var(--c-text-muted)] transition-colors hover:border-[color:var(--c-border-strong)] hover:text-[color:var(--c-text)]" +
                        (composing || images.length >= MAX_IMAGES ? " pointer-events-none opacity-60" : "")
                    }
                >
                    <input
                        type="file"
                        accept="image/*"
                        multiple
                        disabled={composing || images.length >= MAX_IMAGES}
                        onChange={(e) => onFiles(e.target.files)}
                        className="sr-only"
                    />
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                        <path d="M12 5v14M5 12h14" />
                    </svg>
                    {images.length === 0 ? "Add screenshots" : `Add more (${MAX_IMAGES - images.length} left)`}
                </label>
                {imageError && (
                    <p className="text-[11.5px] text-amber-700">{imageError}</p>
                )}
            </div>

            {composeError && (
                <p role="alert" className="rounded-[10px] bg-rose-50 px-3 py-2 text-[12.5px] text-rose-800">
                    {composeError}
                </p>
            )}

            <div className="mt-1 flex justify-end gap-2">
                <button type="button" onClick={onCancel} disabled={composing} className="btn-ghost">
                    Cancel
                </button>
                <button type="button" onClick={onCompose} disabled={!canCompose} className="btn-primary">
                    {composing ? (<><Spinner />Drafting…</>) : (<><SparkleIcon />Draft with AI</>)}
                </button>
            </div>
        </div>
    )
}

function ReviewStep({
    proposal, setProposal,
    similar, similarLoading,
    onBack, onCreate, onMarkDuplicate,
    creating, createError,
}: {
    proposal: IssueProposal
    setProposal: (p: IssueProposal) => void
    similar: SimilarIssue[] | null
    similarLoading: boolean
    onBack: () => void
    onCreate: () => void
    onMarkDuplicate: (d: SimilarIssue) => void
    creating: boolean
    createError: string | null
}) {
    // Edit/Preview tab on the body field. Default to Preview because
    // the AI-drafted markdown is the thing the user wants to verify
    // first; edits are usually a small touch-up.
    const [bodyView, setBodyView] = useState<"edit" | "preview">("preview")
    const labelsString = useMemo(() => proposal.labels.join(", "), [proposal.labels])
    return (
        <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.08em] text-[color:var(--c-text-muted)]">
                <SparkleIcon />
                <span>AI draft</span>
                <span className="rounded-full bg-[color:var(--c-surface-2)] px-1.5 py-[1px] text-[10px] tracking-normal normal-case font-semibold text-[color:var(--c-text-muted)]">
                    {proposal.confidence} confidence
                </span>
            </div>

            <label className="flex flex-col gap-1">
                <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-[color:var(--c-text-muted)]">
                    Title
                </span>
                <input
                    value={proposal.title}
                    onChange={(e) => setProposal({ ...proposal, title: e.target.value })}
                    className="input text-[14px] font-semibold"
                />
            </label>

            <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-[color:var(--c-text-muted)]">
                        Body
                    </span>
                    <div
                        role="tablist"
                        aria-label="Body view"
                        className="inline-flex rounded-[8px] border border-[color:var(--c-border)] bg-[color:var(--c-surface-2)] p-0.5 text-[11.5px] font-semibold"
                    >
                        <button
                            type="button"
                            role="tab"
                            aria-selected={bodyView === "edit"}
                            onClick={() => setBodyView("edit")}
                            className={
                                "rounded-[6px] px-2.5 py-1 transition-colors " +
                                (bodyView === "edit"
                                    ? "bg-white text-[color:var(--c-text)] shadow-sm"
                                    : "text-[color:var(--c-text-muted)] hover:text-[color:var(--c-text)]")
                            }
                        >
                            Edit
                        </button>
                        <button
                            type="button"
                            role="tab"
                            aria-selected={bodyView === "preview"}
                            onClick={() => setBodyView("preview")}
                            className={
                                "rounded-[6px] px-2.5 py-1 transition-colors " +
                                (bodyView === "preview"
                                    ? "bg-white text-[color:var(--c-text)] shadow-sm"
                                    : "text-[color:var(--c-text-muted)] hover:text-[color:var(--c-text)]")
                            }
                        >
                            Preview
                        </button>
                    </div>
                </div>
                {bodyView === "edit" ? (
                    <textarea
                        rows={10}
                        value={proposal.body}
                        onChange={(e) => setProposal({ ...proposal, body: e.target.value })}
                        className="input text-[13px] leading-relaxed font-mono"
                        placeholder="Markdown supported. The body should describe the issue itself — priority/labels/confidence are separate fields."
                    />
                ) : (
                    <div className="min-h-[180px] rounded-[12px] border border-[color:var(--c-border)] bg-white px-3.5 py-3">
                        {proposal.body.trim() ? (
                            <div className="prose-tracker">
                                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                    {proposal.body}
                                </ReactMarkdown>
                            </div>
                        ) : (
                            <p className="text-[12.5px] text-[color:var(--c-text-dim)]">
                                Empty body — switch to Edit to add details.
                            </p>
                        )}
                    </div>
                )}
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1">
                    <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-[color:var(--c-text-muted)]">
                        Priority
                    </span>
                    <Dropdown<IssuePriority>
                        value={proposal.priority}
                        onChange={(v) => setProposal({ ...proposal, priority: v })}
                        options={PRIORITY_OPTIONS}
                        aria-label="Priority"
                    />
                </label>
                <label className="flex flex-col gap-1">
                    <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-[color:var(--c-text-muted)]">
                        Labels <span className="font-medium normal-case tracking-normal text-[color:var(--c-text-dim)]">(comma-separated)</span>
                    </span>
                    <input
                        value={labelsString}
                        onChange={(e) => setProposal({
                            ...proposal,
                            labels: e.target.value.split(",").map((l) => l.trim()).filter(Boolean),
                        })}
                        className="input text-[13px]"
                    />
                </label>
            </div>

            <SimilarPanel
                similar={similar}
                loading={similarLoading}
                onMarkDuplicate={onMarkDuplicate}
                disabled={creating}
            />

            {createError && (
                <p role="alert" className="rounded-[10px] bg-rose-50 px-3 py-2 text-[12.5px] text-rose-800">
                    {createError}
                </p>
            )}

            <div className="mt-1 flex flex-wrap justify-between gap-2">
                <button type="button" onClick={onBack} disabled={creating} className="btn-ghost">
                    ← Back
                </button>
                <button
                    type="button"
                    onClick={onCreate}
                    disabled={creating || !proposal.title.trim()}
                    className="btn-primary"
                >
                    {creating ? (<><Spinner />Creating…</>) : "Create issue"}
                </button>
            </div>
        </div>
    )
}

function SimilarPanel({
    similar, loading, onMarkDuplicate, disabled,
}: {
    similar: SimilarIssue[] | null
    loading: boolean
    onMarkDuplicate: (d: SimilarIssue) => void
    disabled: boolean
}) {
    if (loading && similar === null) {
        return (
            <div className="rounded-[12px] border border-dashed border-[color:var(--c-border)] bg-[color:var(--c-surface-2)] px-3 py-2.5 text-[12px] text-[color:var(--c-text-muted)]">
                <Spinner /> Looking for similar issues…
            </div>
        )
    }
    if (!similar || similar.length === 0) return null

    return (
        <div className="rounded-[12px] border border-amber-200 bg-amber-50/60 p-3">
            <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-amber-900">
                Looks similar to
            </div>
            <ul className="mt-2 flex flex-col divide-y divide-amber-200/70">
                {similar.map((s) => (
                    <li key={s.id} className="flex items-center gap-3 py-2">
                        <span className="rounded-md bg-white/70 px-1.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums text-amber-900">
                            #{s.issue_number}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-[13px] text-[color:var(--c-text)]">
                            {s.title}
                        </span>
                        <span className="shrink-0 text-[10.5px] uppercase tracking-[0.08em] text-amber-800/80">
                            {Math.round(s.similarity * 100)}%
                        </span>
                        <button
                            type="button"
                            onClick={() => onMarkDuplicate(s)}
                            disabled={disabled}
                            className="shrink-0 rounded-[8px] bg-amber-900 px-2.5 py-1 text-[11.5px] font-semibold text-white hover:bg-amber-950 disabled:opacity-60"
                        >
                            Mark as duplicate
                        </button>
                    </li>
                ))}
            </ul>
            <p className="mt-2 text-[11px] text-amber-900/80">
                Choose &ldquo;Mark as duplicate&rdquo; to file this report linked to one of the above. The maintainer will see both.
            </p>
        </div>
    )
}

function SparkleIcon() {
    return (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M12 2l1.7 5.3L19 9l-5.3 1.7L12 16l-1.7-5.3L5 9l5.3-1.7L12 2zm6 11l.9 2.6L21 16.5l-2.1.9L18 20l-.9-2.6L15 16.5l2.1-.9.9-2.5z" />
        </svg>
    )
}
