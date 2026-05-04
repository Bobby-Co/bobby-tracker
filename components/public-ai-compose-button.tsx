"use client"

import { useState } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { Modal } from "@/components/modal"
import { Spinner } from "@/components/spinner"
import { compressImage, type CompressedImage } from "@/lib/image-compress"
import type { IssuePriority } from "@/lib/supabase/types"

interface PublicProposal {
    title: string
    body: string
    priority: IssuePriority
    labels: string[]
    confidence: "low" | "medium" | "high"
}

const MAX_IMAGES = 6

// Public-side AI Compose. Mirrors the maintainer-side modal but
// hits /api/public-issues/ai-compose (token-authed, not cookie-
// authed). On accept, calls back into the parent form with a
// proposal so the form's title/body/priority fields get pre-filled
// — submission still flows through the regular Submit button so
// reporter id, sign-in invite checks, and embedding all happen
// exactly as they would for a hand-typed submission.
export function PublicAiComposeButton({
    token,
    projectId,
    onAccept,
}: {
    token: string
    projectId: string
    onAccept: (proposal: PublicProposal) => void
}) {
    const [open, setOpen] = useState(false)
    return (
        <>
            <button
                type="button"
                onClick={() => setOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-[10px] border border-[color:var(--c-border)] bg-white px-3 py-1.5 text-[12.5px] font-semibold text-[color:var(--c-text)] transition-colors hover:border-[color:var(--c-border-strong)]"
            >
                <SparkleIcon />
                Draft with AI
            </button>
            <Modal
                open={open}
                onClose={() => setOpen(false)}
                title="Draft with AI"
                description="Describe what's wrong (or paste a screenshot). The model writes a clean draft you can review before submitting."
                size="lg"
            >
                <ComposeBody
                    token={token}
                    projectId={projectId}
                    onAccept={(p) => { onAccept(p); setOpen(false) }}
                    onCancel={() => setOpen(false)}
                />
            </Modal>
        </>
    )
}

function ComposeBody({
    token, projectId, onAccept, onCancel,
}: {
    token: string
    projectId: string
    onAccept: (p: PublicProposal) => void
    onCancel: () => void
}) {
    const [paragraph, setParagraph] = useState("")
    const [images, setImages] = useState<CompressedImage[]>([])
    const [imageError, setImageError] = useState<string | null>(null)
    const [composeError, setComposeError] = useState<string | null>(null)
    const [composing, setComposing] = useState(false)
    const [proposal, setProposal] = useState<PublicProposal | null>(null)
    const [bodyView, setBodyView] = useState<"edit" | "preview">("preview")

    async function handleFiles(fl: FileList | null) {
        if (!fl) return
        setImageError(null)
        const files = Array.from(fl).filter((f) => f.type.startsWith("image/"))
        const room = MAX_IMAGES - images.length
        if (files.length > room) {
            setImageError(`Only ${MAX_IMAGES} images allowed — keeping the first ${room}.`)
        }
        try {
            const compressed = await Promise.all(files.slice(0, room).map((f) => compressImage(f)))
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
            const res = await fetch("/api/public-issues/ai-compose", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    token,
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
            setProposal(data.proposal as PublicProposal)
        } catch (e) {
            setComposeError(e instanceof Error ? e.message : String(e))
        } finally {
            setComposing(false)
        }
    }

    if (!proposal) {
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
                                        onClick={() => removeImage(idx)}
                                        disabled={composing}
                                        aria-label={`Remove image ${idx + 1}`}
                                        className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-zinc-900/80 text-white opacity-0 transition-opacity group-hover:opacity-100"
                                    >
                                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden>
                                            <path d="M6 6l12 12M18 6L6 18" />
                                        </svg>
                                    </button>
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
                            onChange={(e) => handleFiles(e.target.files)}
                            className="sr-only"
                        />
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                            <path d="M12 5v14M5 12h14" />
                        </svg>
                        {images.length === 0 ? "Add screenshots" : `Add more (${MAX_IMAGES - images.length} left)`}
                    </label>
                    {imageError && <p className="text-[11.5px] text-amber-700">{imageError}</p>}
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
                    <button type="button" onClick={compose} disabled={!canCompose} className="btn-primary">
                        {composing ? (<><Spinner />Drafting…</>) : (<><SparkleIcon />Draft with AI</>)}
                    </button>
                </div>
            </div>
        )
    }

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
                    <div role="tablist" className="inline-flex rounded-[8px] border border-[color:var(--c-border)] bg-[color:var(--c-surface-2)] p-0.5 text-[11.5px] font-semibold">
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
                    />
                ) : (
                    <div className="min-h-[180px] max-h-[320px] overflow-y-auto rounded-[12px] border border-[color:var(--c-border)] bg-white px-3.5 py-3">
                        {proposal.body.trim() ? (
                            <div className="prose-tracker">
                                <ReactMarkdown remarkPlugins={[remarkGfm]}>{proposal.body}</ReactMarkdown>
                            </div>
                        ) : (
                            <p className="text-[12.5px] text-[color:var(--c-text-dim)]">
                                Empty body — switch to Edit to add details.
                            </p>
                        )}
                    </div>
                )}
            </div>

            <div className="mt-1 flex flex-wrap justify-between gap-2">
                <button type="button" onClick={() => setProposal(null)} className="btn-ghost">
                    ← Back
                </button>
                <button
                    type="button"
                    onClick={() => onAccept(proposal)}
                    disabled={!proposal.title.trim()}
                    className="btn-primary"
                >
                    Use this draft
                </button>
            </div>
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
