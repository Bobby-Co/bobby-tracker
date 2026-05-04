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

interface MemberInfo {
    id: string
    name: string
    has_summary: boolean
}

interface IssueProposal {
    title: string
    body: string
    priority: IssuePriority
    labels: string[]
    confidence: "low" | "medium" | "high"
}

interface RankedProject {
    project_id: string
    project_name: string
    analyser_ready: boolean
    has_summary: boolean
    similarity: number
    breakdown: {
        main:    number | null
        layer:   number | null
        feature: number | null
    } | null
}

const PRIORITY_OPTIONS = ISSUE_PRIORITIES.map((p) => ({ value: p, label: p }))
const MAX_IMAGES = 6

// Group-aware AI compose flow. Three steps inside one modal:
//
//   1. Capture — paragraph + screenshots, like the per-project
//      AI compose. POST to /api/groups/[id]/ai-compose, which
//      composes the draft AND embeds it AND ranks the group's
//      projects in one round-trip.
//   2. Review — pre-filled editable form + ranked-projects panel
//      with per-facet score breakdown. Top match is pre-selected;
//      user can pick any non-zero subset to fan the issue out.
//   3. Submit — POST /api/issues per selected project (parallel
//      fan-out), then route to the first created issue's detail
//      page.
//
// "Not indexed" projects appear in the panel but are deselected by
// default (no analyser graph → POST /api/issues would 409 anyway).
// Tooltips explain why.
export function GroupAiComposeButton({
    groupId,
    members,
    disabled,
    disabledReason,
}: {
    groupId: string
    members: MemberInfo[]
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
                className="btn-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
                <SparkleIcon />
                Compose with AI
            </button>
            <Modal
                open={open}
                onClose={() => setOpen(false)}
                title="Compose & route across the group"
                description="The model drafts the issue and scores each project so you can route it (or split it) where it belongs."
                size="lg"
            >
                <Body groupId={groupId} memberCount={members.length} onClose={() => setOpen(false)} />
            </Modal>
        </>
    )
}

function Body({
    groupId, memberCount, onClose,
}: {
    groupId: string
    memberCount: number
    onClose: () => void
}) {
    const router = useRouter()
    const [paragraph, setParagraph] = useState("")
    const [images, setImages] = useState<CompressedImage[]>([])
    const [imageError, setImageError] = useState<string | null>(null)
    const [composeError, setComposeError] = useState<string | null>(null)
    const [composing, setComposing] = useState(false)
    const [proposal, setProposal] = useState<IssueProposal | null>(null)
    const [ranking, setRanking] = useState<RankedProject[]>([])
    const [routingQuery, setRoutingQuery] = useState<string | null>(null)
    const [picked, setPicked] = useState<Set<string>>(new Set())
    const [creating, startCreate] = useTransition()
    const [createError, setCreateError] = useState<string | null>(null)

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
            const res = await fetch(`/api/groups/${groupId}/ai-compose`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ paragraph, images: images.map((i) => i.dataUrl) }),
            })
            if (!res.ok) {
                const e = await res.json().catch(() => ({}))
                setComposeError(e?.error?.message || `Failed (${res.status})`)
                return
            }
            const data = await res.json()
            const p = data.proposal as IssueProposal
            const r = (data.ranking as RankedProject[]) ?? []
            setProposal(p)
            setRanking(r)
            setRoutingQuery(typeof data.routing_query === "string" ? data.routing_query : null)
            // Default selection: best ranked + analyser-ready project
            // only. The user can opt in to additional or unindexed
            // ones from the panel.
            const top = r.find((x) => x.analyser_ready && x.has_summary)
                ?? r.find((x) => x.analyser_ready)
            setPicked(top ? new Set([top.project_id]) : new Set())
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

    function backToCapture() {
        setProposal(null)
        setRanking([])
        setRoutingQuery(null)
        setPicked(new Set())
    }

    function createIssues() {
        if (!proposal) return
        const targets = Array.from(picked)
        if (targets.length === 0) return
        setCreateError(null)
        startCreate(async () => {
            // Fan out one POST per target. Same proposal content
            // landing in each project; each gets its own embedding
            // via the existing fire-and-forget on POST /api/issues.
            const results = await Promise.all(targets.map(async (project_id) => {
                const res = await fetch("/api/issues", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        project_id,
                        title: proposal.title,
                        body: proposal.body,
                        priority: proposal.priority,
                        labels: proposal.labels,
                        ai_proposed: true,
                    }),
                })
                if (!res.ok) {
                    const e = await res.json().catch(() => ({}))
                    return { project_id, error: e?.error?.message || `Failed (${res.status})` }
                }
                const data = await res.json().catch(() => ({}))
                return { project_id, issueId: data?.issue?.id as string | undefined }
            }))
            const failed = results.filter((r) => "error" in r)
            const created = results.filter((r) => "issueId" in r && r.issueId)
            if (failed.length > 0 && created.length === 0) {
                setCreateError(failed.map((f) => f.error).join("; "))
                return
            }
            onClose()
            router.refresh()
            const first = created[0]
            if (first && "issueId" in first && first.issueId) {
                router.push(`/projects/${first.project_id}/issues/${first.issueId}`)
            }
        })
    }

    if (memberCount === 0) {
        return (
            <p className="rounded-[10px] bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900">
                Add at least one project to this group before composing.
            </p>
        )
    }

    if (!proposal) {
        return <CaptureStep
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
    }

    return <ReviewStep
        proposal={proposal}
        setProposal={setProposal}
        ranking={ranking}
        routingQuery={routingQuery}
        picked={picked}
        onTogglePicked={togglePicked}
        onBack={backToCapture}
        onCreate={createIssues}
        creating={creating}
        createError={createError}
    />
}

function CaptureStep({
    paragraph, setParagraph, images, onFiles, onRemoveImage, imageError,
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
                    placeholder="Describe what you saw, what you expected, steps to reproduce — whatever you've got. The AI will draft and route."
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
                <button type="button" onClick={onCompose} disabled={!canCompose} className="btn-primary">
                    {composing ? (<><Spinner />Drafting & routing…</>) : (<><SparkleIcon />Draft & route</>)}
                </button>
            </div>
        </div>
    )
}

function ReviewStep({
    proposal, setProposal, ranking, routingQuery, picked, onTogglePicked,
    onBack, onCreate, creating, createError,
}: {
    proposal: IssueProposal
    setProposal: (p: IssueProposal) => void
    ranking: RankedProject[]
    routingQuery: string | null
    picked: Set<string>
    onTogglePicked: (id: string) => void
    onBack: () => void
    onCreate: () => void
    creating: boolean
    createError: string | null
}) {
    const [bodyView, setBodyView] = useState<"edit" | "preview">("preview")
    const labelsString = useMemo(() => proposal.labels.join(", "), [proposal.labels])
    const pickedReady = ranking.filter((r) => picked.has(r.project_id) && r.analyser_ready).length

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
                            <p className="text-[12.5px] text-[color:var(--c-text-dim)]">Empty body — switch to Edit.</p>
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

            <RankingPanel ranking={ranking} picked={picked} onToggle={onTogglePicked} />

            {routingQuery && (
                <details className="rounded-[10px] border border-[color:var(--c-border)] bg-[color:var(--c-bg-soft)] px-3 py-2 text-[12px]">
                    <summary className="cursor-pointer select-none font-bold uppercase tracking-[0.08em] text-[10.5px] text-[color:var(--c-text-muted)]">
                        Routing query
                    </summary>
                    <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-[11.5px] leading-snug text-[color:var(--c-text-dim)]">{routingQuery}</pre>
                </details>
            )}

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
                    disabled={creating || pickedReady === 0 || !proposal.title.trim()}
                    className="btn-primary"
                >
                    {creating
                        ? (<><Spinner />Creating…</>)
                        : pickedReady > 1
                            ? `Create ${pickedReady} issues`
                            : "Create issue"}
                </button>
            </div>
        </div>
    )
}

function RankingPanel({
    ranking, picked, onToggle,
}: {
    ranking: RankedProject[]
    picked: Set<string>
    onToggle: (id: string) => void
}) {
    if (ranking.length === 0) return null
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
                                                title="No summary embedding yet — re-index on the project's Knowledge tab."
                                            >
                                                no summary
                                            </span>
                                        )}
                                        {blocked && (
                                            <span
                                                className="rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em] text-rose-800"
                                                title="Analyser isn't ready for this project — index it before filing here."
                                            >
                                                not indexed
                                            </span>
                                        )}
                                    </div>
                                    {r.breakdown && (
                                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10.5px] text-[color:var(--c-text-dim)]">
                                            <Facet label="main"    value={r.breakdown.main} />
                                            <Facet label="layer"   value={r.breakdown.layer} />
                                            <Facet label="feature" value={r.breakdown.feature} />
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
