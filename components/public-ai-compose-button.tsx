"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { Modal } from "@/components/modal"
import { Spinner } from "@/components/spinner"
import { compressImage, type CompressedImage } from "@/lib/image-compress"
import { readName, readReporterId } from "@/lib/public-profile"
import type { IssuePriority } from "@/lib/supabase/types"

interface RankedProject {
    project_id: string
    project_name: string
    analyser_ready: boolean
    has_summary: boolean
    similarity: number
    breakdown: {
        layer:    number | null
        feature:  number | null
        modules:  number | null
        overview: number | null
        stack:    number | null
    } | null
}

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
    const router = useRouter()
    const [paragraph, setParagraph] = useState("")
    const [images, setImages] = useState<CompressedImage[]>([])
    const [imageError, setImageError] = useState<string | null>(null)
    const [composeError, setComposeError] = useState<string | null>(null)
    const [composing, setComposing] = useState(false)
    const [proposal, setProposal] = useState<PublicProposal | null>(null)
    const [ranking, setRanking] = useState<RankedProject[]>([])
    const [picked, setPicked] = useState<Set<string>>(new Set())
    const [submitting, setSubmitting] = useState(false)
    const [submitError, setSubmitError] = useState<string | null>(null)
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
            const p = data.proposal as PublicProposal
            const r = (data.ranking as RankedProject[] | null) ?? []
            setProposal(p)
            setRanking(r)
            // Group-mode default: pre-select the top analyser-ready
            // project. Manual mode (no ranking) uses the existing
            // accept-into-form path so picked stays empty.
            if (r.length > 0) {
                const top = r.find((x) => x.analyser_ready && x.has_summary)
                    ?? r.find((x) => x.analyser_ready)
                setPicked(top ? new Set([top.project_id]) : new Set())
            }
        } catch (e) {
            setComposeError(e instanceof Error ? e.message : String(e))
        } finally {
            setComposing(false)
        }
    }

    function togglePicked(id: string) {
        setPicked((cur) => {
            const next = new Set(cur)
            if (next.has(id)) next.delete(id)
            else next.add(id)
            return next
        })
    }

    async function submitRouted() {
        if (!proposal) return
        const targets = Array.from(picked)
        if (targets.length === 0) return
        setSubmitError(null)
        setSubmitting(true)
        try {
            const reporter = readName()
            const reporter_id = readReporterId()
            // Fan out one POST per target. Each public submission is
            // its own row with its own embedding + reporter_id;
            // sharing the same draft content but routed by the user.
            const results = await Promise.all(targets.map(async (project_id) => {
                const res = await fetch("/api/public-issues", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        token,
                        project_id,
                        reporter,
                        reporter_id,
                        title: proposal.title,
                        body: proposal.body,
                        priority: proposal.priority,
                    }),
                })
                if (!res.ok) {
                    const e = await res.json().catch(() => ({}))
                    return { project_id, error: e?.error?.message || `Failed (${res.status})` }
                }
                const data = await res.json().catch(() => ({}))
                return { project_id, issueId: data?.issue?.id as string | undefined }
            }))
            const failed = results.filter((r): r is { project_id: string; error: string } => "error" in r)
            const created = results.filter((r): r is { project_id: string; issueId: string } => "issueId" in r && !!r.issueId)
            if (failed.length > 0 && created.length === 0) {
                setSubmitError(failed.map((f) => f.error).join("; "))
                return
            }
            // Refresh the parent listing so the new submissions
            // surface immediately.
            router.refresh()
            const first = created[0]
            if (first) {
                router.push(`/p/${token}/issues/${first.issueId}`)
            }
        } catch (e) {
            setSubmitError(e instanceof Error ? e.message : String(e))
        } finally {
            setSubmitting(false)
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

            {/* Group-mode routing panel. Present iff the API returned
                a ranking — i.e. the session is backed by a project
                group and find_similar_projects scored each member.
                Submitter picks one or more targets; the modal owns
                the fan-out and skips the parent form's flow entirely. */}
            {ranking.length > 0 && (
                <RoutingPanel ranking={ranking} picked={picked} onToggle={togglePicked} />
            )}

            {submitError && (
                <p role="alert" className="rounded-[10px] bg-rose-50 px-3 py-2 text-[12.5px] text-rose-800">
                    {submitError}
                </p>
            )}

            <div className="mt-1 flex flex-wrap justify-between gap-2">
                <button
                    type="button"
                    onClick={() => { setProposal(null); setRanking([]); setPicked(new Set()) }}
                    disabled={submitting}
                    className="btn-ghost"
                >
                    ← Back
                </button>
                {ranking.length > 0 ? (
                    <button
                        type="button"
                        onClick={submitRouted}
                        disabled={submitting || picked.size === 0 || !proposal.title.trim()}
                        className="btn-primary"
                    >
                        {submitting
                            ? (<><Spinner />Submitting…</>)
                            : picked.size > 1
                                ? `Submit ${picked.size} issues`
                                : "Submit issue"}
                    </button>
                ) : (
                    <button
                        type="button"
                        onClick={() => onAccept(proposal)}
                        disabled={!proposal.title.trim()}
                        className="btn-primary"
                    >
                        Use this draft
                    </button>
                )}
            </div>
        </div>
    )
}

function RoutingPanel({
    ranking, picked, onToggle,
}: {
    ranking: RankedProject[]
    picked: Set<string>
    onToggle: (id: string) => void
}) {
    return (
        <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-[color:var(--c-text-muted)]">
                    Route to
                </span>
                <span className="text-[10.5px] text-[color:var(--c-text-dim)]">
                    Modules 40% · Overview 25% · Features 20% · Stack 15%
                </span>
            </div>
            <ul className="flex flex-col gap-1.5">
                {ranking.map((r) => {
                    const isPicked = picked.has(r.project_id)
                    const blocked = !r.analyser_ready
                    return (
                        <li key={r.project_id}>
                            <label
                                className={
                                    "flex items-center gap-3 rounded-[10px] border bg-white px-3 py-2 transition-colors " +
                                    (isPicked
                                        ? "border-zinc-900 bg-[color:var(--c-surface-2)]"
                                        : "border-[color:var(--c-border)] hover:border-[color:var(--c-border-strong)]") +
                                    (blocked ? " opacity-60" : " cursor-pointer")
                                }
                            >
                                <input
                                    type="checkbox"
                                    checked={isPicked}
                                    onChange={() => onToggle(r.project_id)}
                                    disabled={blocked}
                                    className="h-4 w-4 accent-zinc-900"
                                />
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2">
                                        <span className="truncate text-[13px] font-semibold">{r.project_name}</span>
                                        {!r.has_summary && (
                                            <span
                                                className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em] text-amber-800"
                                                title="No summary embedding yet — re-index this project to enable routing scores."
                                            >
                                                no summary
                                            </span>
                                        )}
                                        {blocked && (
                                            <span
                                                className="rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em] text-rose-800"
                                                title="Analyser isn't ready for this project — submission will fail until indexed."
                                            >
                                                not indexed
                                            </span>
                                        )}
                                    </div>
                                    {r.breakdown && (
                                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10.5px] text-[color:var(--c-text-dim)]">
                                            <Facet label="layer"    value={r.breakdown.layer} />
                                            <Facet label="feature"  value={r.breakdown.feature} />
                                            <Facet label="modules"  value={r.breakdown.modules} />
                                            <Facet label="overview" value={r.breakdown.overview} />
                                            <Facet label="stack"    value={r.breakdown.stack} />
                                        </div>
                                    )}
                                </div>
                                <span className="shrink-0 text-[12px] font-bold tabular-nums text-[color:var(--c-text)]">
                                    {Math.round(r.similarity * 100)}%
                                </span>
                            </label>
                        </li>
                    )
                })}
            </ul>
        </div>
    )
}

function Facet({ label, value }: { label: string; value: number | null }) {
    if (value == null) {
        return (
            <span className="rounded bg-[color:var(--c-surface-2)] px-1.5 py-[1px] text-[color:var(--c-text-dim)]">
                {label} · —
            </span>
        )
    }
    return (
        <span className="rounded bg-[color:var(--c-surface-2)] px-1.5 py-[1px]">
            {label} · <span className="font-semibold text-[color:var(--c-text)]">{Math.round(value * 100)}%</span>
        </span>
    )
}

function SparkleIcon() {
    return (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M12 2l1.7 5.3L19 9l-5.3 1.7L12 16l-1.7-5.3L5 9l5.3-1.7L12 2zm6 11l.9 2.6L21 16.5l-2.1.9L18 20l-.9-2.6L15 16.5l2.1-.9.9-2.5z" />
        </svg>
    )
}
