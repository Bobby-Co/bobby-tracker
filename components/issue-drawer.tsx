"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { cn } from "@/components/cn"
import { IconlyIcon } from "@/components/iconly-icon"
import { defaultLabelColor, softLabelChipStyle } from "@/lib/timeline/labels"
import { DEFAULT_STATUS_COLORS, isDarkColor } from "@/lib/timeline/colors"
import type {
    Issue,
    IssueAnalysisData,
    IssueFinding,
    IssueStatus,
    IssueSuggestion,
    ProjectLabelIcon,
    ProjectStatusColor,
} from "@/lib/supabase/types"

// IssueDrawer — left-side slide-in panel shown when a tile is
// clicked on the planning timeline. Mirrors the drawer in the
// reference design: title + labels, body, similarity check status,
// analyser summary card with file list, "Visit this issue" CTA.
//
// Suggestions are loaded lazily on open via GET /api/issues/[id]/
// suggestions so the timeline page itself stays light.
export function IssueDrawer({
    issue,
    projectId,
    labelIcons,
    statusColors,
    onClose,
}: {
    issue: Issue | null
    projectId: string
    labelIcons: ProjectLabelIcon[]
    statusColors: ProjectStatusColor[]
    onClose: () => void
}) {
    const [suggestion, setSuggestion] = useState<IssueSuggestion | null>(null)
    const [loadingSuggestion, setLoadingSuggestion] = useState(false)

    // Match the issue prop without an effect — recommended pattern
    // for resetting state on prop change. We flip loading to true
    // here too so the spinner shows on the very next paint instead
    // of one frame later.
    const [seenId, setSeenId] = useState<string | null>(null)
    if (issue && issue.id !== seenId) {
        setSeenId(issue.id)
        setSuggestion(null)
        setLoadingSuggestion(true)
    }

    useEffect(() => {
        if (!issue) return
        let cancelled = false
        fetch(`/api/issues/${issue.id}/suggestions`)
            .then((r) => (r.ok ? r.json() : Promise.reject(r)))
            .then((j: { suggestion: IssueSuggestion | null }) => {
                if (cancelled) return
                setSuggestion(j.suggestion)
                setLoadingSuggestion(false)
            })
            .catch(() => {
                if (cancelled) return
                setLoadingSuggestion(false)
            })
        return () => { cancelled = true }
    }, [issue])

    useEffect(() => {
        if (!issue) return
        function onKey(e: KeyboardEvent) {
            if (e.key === "Escape") onClose()
        }
        document.addEventListener("keydown", onKey)
        return () => document.removeEventListener("keydown", onKey)
    }, [issue, onClose])

    const open = !!issue
    const colorOverride = issue
        ? (statusColors.find((c) => c.status === issue.status)?.color ?? null)
        : null

    return (
        <>
            {/* backdrop */}
            <div
                aria-hidden
                onClick={onClose}
                className={cn(
                    "fixed inset-0 z-40 bg-zinc-950/30 backdrop-blur-[2px] transition-opacity",
                    open ? "opacity-100" : "pointer-events-none opacity-0",
                )}
            />
            {/* drawer */}
            <aside
                role="dialog"
                aria-modal="true"
                aria-hidden={!open}
                className={cn(
                    "fixed inset-y-0 left-0 z-50 flex w-full max-w-md flex-col border-r-[3px] border-r-violet-400 bg-[#fafafa] shadow-[var(--shadow-pop)] transition-transform",
                    open ? "translate-x-0" : "-translate-x-full",
                )}
            >
                {issue && (
                    <DrawerBody
                        issue={issue}
                        projectId={projectId}
                        suggestion={suggestion}
                        loadingSuggestion={loadingSuggestion}
                        labelIcons={labelIcons}
                        colorOverride={colorOverride}
                        onClose={onClose}
                    />
                )}
            </aside>
        </>
    )
}

function DrawerBody({
    issue,
    projectId,
    suggestion,
    loadingSuggestion,
    labelIcons,
    colorOverride,
    onClose,
}: {
    issue: Issue
    projectId: string
    suggestion: IssueSuggestion | null
    loadingSuggestion: boolean
    labelIcons: ProjectLabelIcon[]
    colorOverride: string | null
    onClose: () => void
}) {
    const router = useRouter()
    const labelIconMap = new Map(labelIcons.map((i) => [i.label, i]))
    const fill = issue.color ?? colorOverride ?? DEFAULT_STATUS_COLORS[issue.status as IssueStatus]
    const fg = isDarkColor(fill) ? "#ffffff" : "#0a0a0a"

    // Local mirror of the issue's labels so the hover-X removal
    // is instant. We resync when the drawer is reopened with a
    // different issue (id-keyed prop sync).
    const [localLabels, setLocalLabels] = useState<string[]>(issue.labels)
    const [seenIssueId, setSeenIssueId] = useState(issue.id)
    if (issue.id !== seenIssueId) {
        setSeenIssueId(issue.id)
        setLocalLabels(issue.labels)
    }

    async function removeLabel(label: string) {
        const next = localLabels.filter((l) => l !== label)
        setLocalLabels(next)
        try {
            await fetch(`/api/issues/${issue.id}`, {
                method: "PATCH",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ labels: next }),
            })
            router.refresh()
        } catch {
            // Revert on failure so the chip reappears.
            setLocalLabels(localLabels)
        }
    }

    const data: IssueAnalysisData | null = suggestion?.data ?? null
    const findings: IssueFinding[] = data?.suggestions ?? []
    const cachedAt = suggestion ? timeAgo(suggestion.created_at) : null
    const cost = suggestion?.cost_usd != null ? `$${suggestion.cost_usd.toFixed(4)}` : null

    return (
        <>
            <header className="flex items-start justify-between gap-3 px-7 pt-7">
                <div className="min-w-0">
                    <span
                        className="inline-flex h-6 items-center gap-1.5 rounded-full px-2 text-[10.5px] font-bold uppercase tracking-wide"
                        style={{ background: fill, color: fg }}
                    >
                        <span className="font-mono">#{issue.issue_number}</span>
                        <span aria-hidden>·</span>
                        <span>{issue.status.replace(/_/g, " ")}</span>
                    </span>
                    <h1 className="mt-3 text-[22px] font-extrabold leading-tight tracking-[-0.012em]">
                        {issue.title}
                    </h1>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <PriorityPill priority={issue.priority} />
                        {localLabels.map((l) => (
                            <LabelChip
                                key={l}
                                label={l}
                                cfg={labelIconMap.get(l)}
                                onRemove={() => removeLabel(l)}
                            />
                        ))}
                    </div>
                </div>
                <button
                    type="button"
                    onClick={onClose}
                    aria-label="Close"
                    className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-[color:var(--c-text-dim)] transition-colors hover:bg-[color:var(--c-overlay)] hover:text-[color:var(--c-text)]"
                >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
                        <path d="M6 6l12 12M18 6L6 18" />
                    </svg>
                </button>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto px-7 pt-5 pb-32">
                {issue.body && (
                    <div className="prose-tracker text-[13.5px] leading-6 text-[color:var(--c-text)]">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {issue.body}
                        </ReactMarkdown>
                    </div>
                )}

                <SimilarityCard issue={issue} />

                <AnalyserCard
                    issueId={issue.id}
                    suggestion={suggestion}
                    loading={loadingSuggestion}
                    findings={findings}
                    summary={data?.summary ?? null}
                    cachedAt={cachedAt}
                    cost={cost}
                />
            </div>

            <footer className="absolute inset-x-0 bottom-0 px-7 pb-7">
                <Link
                    href={`/projects/${projectId}/issues/${issue.id}`}
                    className="grid h-12 w-full place-items-center rounded-full bg-zinc-950 text-[13.5px] font-semibold text-white transition-colors hover:bg-zinc-800"
                >
                    Visit this issue
                </Link>
            </footer>
        </>
    )
}

function SimilarityCard({ issue }: { issue: Issue }) {
    // Approximate match for the reference card. The real similarity
    // pipeline indexes embeddings asynchronously; if the issue
    // pre-dates that pipeline (created_at before migration 0015 ran)
    // we surface "unavailable" copy instead of a misleading empty
    // result. Heuristic: created before mid-2025 in this repo.
    const filedAt = Date.parse(issue.created_at)
    const indexingCutoffMs = Date.parse("2025-06-01T00:00:00Z")
    const unavailable = filedAt < indexingCutoffMs
    return (
        <div className="mt-5 rounded-[14px] border border-[color:var(--c-border)] border-dashed bg-white px-4 py-3 text-[12.5px] text-[color:var(--c-text-muted)]">
            <span className="font-semibold text-[color:var(--c-text)]">
                {unavailable ? "Similarity check unavailable." : "Similarity check ready."}
            </span>{" "}
            {unavailable
                ? "This issue was filed before similarity indexing was added, so we can't suggest related issues for it yet."
                : "Open the full issue to see related ones."}
        </div>
    )
}

function AnalyserCard({
    issueId,
    suggestion,
    loading,
    findings,
    summary,
    cachedAt,
    cost,
}: {
    issueId: string
    suggestion: IssueSuggestion | null
    loading: boolean
    findings: IssueFinding[]
    summary: string | null
    cachedAt: string | null
    cost: string | null
}) {
    return (
        <section className="mt-5 rounded-[16px] border border-[color:var(--c-border)] bg-white p-4">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="flex items-center gap-1.5 text-[12.5px] font-semibold">
                        <SparkIcon /> Investigate with analyser
                    </div>
                    {(cachedAt || cost) && (
                        <div className="mt-0.5 text-[11px] text-[color:var(--c-text-muted)]">
                            {cachedAt && <>Cached {cachedAt}</>}
                            {cachedAt && cost && <span> · </span>}
                            {cost && <>{cost}</>}
                        </div>
                    )}
                </div>
                <RegenerateButton issueId={issueId} />
            </div>

            {loading && !suggestion && (
                <p className="mt-3 text-[12px] text-[color:var(--c-text-muted)]">Loading…</p>
            )}

            {!loading && !suggestion && (
                <p className="mt-3 rounded-[10px] border border-dashed border-[color:var(--c-border)] px-3 py-3 text-[12px] text-[color:var(--c-text-muted)]">
                    No analyser run yet. Open the issue to generate one.
                </p>
            )}

            {suggestion && summary && (
                <>
                    <div className="mt-3 text-[10.5px] font-bold uppercase tracking-[0.12em] text-[color:var(--c-text-muted)]">
                        Summary
                    </div>
                    <p className="mt-1 text-[12.5px] leading-5 text-[color:var(--c-text)]">{summary}</p>
                </>
            )}

            {findings.length > 0 && (
                <>
                    <div className="mt-3 text-[10.5px] font-bold uppercase tracking-[0.12em] text-[color:var(--c-text-muted)]">
                        Files to investigate
                    </div>
                    <ul className="mt-2 flex flex-col gap-1.5">
                        {findings.slice(0, 5).map((f, i) => (
                            <li key={i} className="flex items-center gap-2 rounded-[10px] border border-[color:var(--c-border)] bg-white px-2.5 py-1.5">
                                <span className="font-mono text-[11.5px] text-[color:var(--c-text)] truncate flex-1">
                                    {f.file}{f.line != null ? `:${f.line}` : ""}
                                </span>
                                {f.confidence && (
                                    <span className={cn(
                                        "rounded-[4px] px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide",
                                        f.confidence.toLowerCase() === "high" && "bg-emerald-100 text-emerald-700",
                                        f.confidence.toLowerCase() === "medium" && "bg-amber-100 text-amber-700",
                                        f.confidence.toLowerCase() === "low" && "bg-zinc-100 text-zinc-600",
                                    )}>
                                        {f.confidence}
                                    </span>
                                )}
                            </li>
                        ))}
                    </ul>
                </>
            )}

            {suggestion && (
                <div className="mt-3 flex flex-wrap items-center gap-2 text-[10.5px] font-medium text-[color:var(--c-text-muted)]">
                    {suggestion.confidence && (
                        <span className={cn(
                            "rounded-[4px] px-1.5 py-0.5 font-bold uppercase tracking-wide",
                            suggestion.confidence.toLowerCase() === "high" && "bg-emerald-100 text-emerald-700",
                            suggestion.confidence.toLowerCase() === "medium" && "bg-amber-100 text-amber-700",
                            suggestion.confidence.toLowerCase() === "low" && "bg-zinc-100 text-zinc-600",
                        )}>
                            {suggestion.confidence}
                        </span>
                    )}
                    {suggestion.graph_id && (
                        <span className="font-mono">graph: {suggestion.graph_id.slice(0, 10)}</span>
                    )}
                    {suggestion.duration_ms != null && (
                        <span>{(suggestion.duration_ms / 1000).toFixed(1)}s</span>
                    )}
                </div>
            )}
        </section>
    )
}

function RegenerateButton({ issueId }: { issueId: string }) {
    const [busy, setBusy] = useState(false)
    async function trigger() {
        setBusy(true)
        try {
            await fetch(`/api/issues/${issueId}/suggest`, { method: "POST" })
        } finally {
            setBusy(false)
        }
    }
    return (
        <button
            type="button"
            onClick={trigger}
            disabled={busy}
            className="rounded-full bg-zinc-950 px-3 py-1.5 text-[11.5px] font-semibold text-white hover:bg-zinc-800 disabled:opacity-60"
        >
            {busy ? "Running…" : "Regenerate"}
        </button>
    )
}

// LabelChip — a single label rendered with its configured colour
// and icon. On hover the chip expands to reveal an inline X
// button; clicking it removes the label from the issue.
// LabelChip — plain chip used in the drawer. Same shape as the
// editor's SoftChip in `assigned` mode: small always-visible X
// at the right edge, click X to remove. No animations.
function LabelChip({
    label,
    cfg,
    onRemove,
}: {
    label: string
    cfg: ProjectLabelIcon | undefined
    onRemove: () => void
}) {
    const color = cfg?.color ?? defaultLabelColor(label)
    const tint = softLabelChipStyle(color)
    return (
        <span
            className="group inline-flex items-center gap-1.5 rounded-full border pl-2.5 pr-1 py-[3px] text-[11px] font-semibold"
            style={tint}
        >
            <IconlyIcon name={cfg?.icon_name ?? null} size={12} />
            <span>{label}</span>
            <button
                type="button"
                onClick={onRemove}
                aria-label={`Remove label ${label}`}
                title="Remove"
                // Inert at rest (invisible + non-clickable). Only
                // when the chip is actually hovered does the X
                // become visible AND clickable, so casual clicks
                // anywhere on the chip can't trigger remove.
                className="pointer-events-none grid h-4 w-4 shrink-0 place-items-center rounded-full opacity-0 transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100 hover:bg-black/15"
            >
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden>
                    <path d="M6 6l12 12M18 6L6 18" />
                </svg>
            </button>
        </span>
    )
}

function PriorityPill({ priority }: { priority: Issue["priority"] }) {
    const cfg = {
        low:    { bg: "bg-zinc-100",   fg: "text-zinc-600",   label: "low" },
        medium: { bg: "bg-zinc-200",   fg: "text-zinc-700",   label: "medium" },
        high:   { bg: "bg-orange-200", fg: "text-orange-900", label: "high" },
        urgent: { bg: "bg-rose-300",   fg: "text-rose-900",   label: "urgent" },
    }[priority]
    return (
        <span className={cn("inline-flex items-center rounded-full px-2 py-[3px] text-[11px] font-semibold uppercase", cfg.bg, cfg.fg)}>
            {cfg.label}
        </span>
    )
}

function SparkIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M12 2 14 8l6 2-6 2-2 6-2-6-6-2 6-2 2-6Z" />
        </svg>
    )
}

function timeAgo(iso: string): string {
    const ms = Date.now() - new Date(iso).getTime()
    const s = Math.round(ms / 1000)
    if (s < 60) return `${s}s ago`
    const m = Math.round(s / 60)
    if (m < 60) return `${m}m ago`
    const h = Math.round(m / 60)
    if (h < 24) return `${h}h ago`
    const d = Math.round(h / 24)
    return `${d}d ago`
}
