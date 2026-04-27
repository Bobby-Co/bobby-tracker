import Link from "next/link"
import { cn } from "@/components/cn"
import { PriorityChip } from "@/components/status-chip"
import type { Issue, IssueStatus } from "@/lib/supabase/types"

const STATUS_TAG: Record<IssueStatus, { tag: string; label: string }> = {
    open:        { tag: "card-tag-action",  label: "Open" },
    in_progress: { tag: "card-tag-trigger", label: "In progress" },
    blocked:     { tag: "card-tag-rose",    label: "Blocked" },
    done:        { tag: "card-tag-output",  label: "Done" },
    archived:    { tag: "card-tag-muted",   label: "Archived" },
}

// IssueTile is the workflow-card-style tile rendering of an issue. Mirrors
// the reference image: tag at top, title row with icon + ⋮, two-line
// description preview, soft-bg body excerpt with variable highlighting,
// labels + priority pill, footer with #number + relative time.
export function IssueTile({ issue, projectId, index }: { issue: Issue; projectId: string; index?: number }) {
    const { tag, label } = STATUS_TAG[issue.status]
    const description = firstParagraph(issue.body)
    const excerpt = bodyExcerpt(issue.body, description ?? "")

    return (
        <Link
            href={`/projects/${projectId}/issues/${issue.id}`}
            className="group block focus:outline-none"
            tabIndex={0}
        >
            <article
                className="card card-hover anim-rise flex h-full flex-col gap-3"
                style={index != null ? ({ ["--i" as string]: index } as React.CSSProperties) : undefined}
            >
                <span className={cn("card-tag", tag)}>
                    <Dot /> {label}
                </span>

                <div className="card-title">
                    <IssueIcon />
                    <span className="line-clamp-2 leading-snug">{issue.title}</span>
                    <span className="card-menu-btn">
                        <DotsIcon />
                    </span>
                </div>

                {description && (
                    <p className="line-clamp-2 text-[12.5px] leading-5 text-[color:var(--c-text-muted)]">
                        {description}
                    </p>
                )}

                {excerpt && <ExcerptBox text={excerpt} />}

                <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-1">
                    <PriorityChip priority={issue.priority} />
                    {issue.labels.slice(0, 2).map((l) => (
                        <span
                            key={l}
                            className="rounded-full border border-[color:var(--c-border)] bg-[color:var(--c-surface-2)] px-2 py-[2px] text-[11px] font-semibold text-[color:var(--c-text-muted)]"
                        >
                            {l}
                        </span>
                    ))}
                    {issue.labels.length > 2 && (
                        <span className="text-[11px] text-[color:var(--c-text-dim)]">
                            +{issue.labels.length - 2}
                        </span>
                    )}
                </div>

                <div className="card-footer">
                    <span className="font-mono">#{issue.issue_number}</span>
                    <span className="inline-flex items-center gap-1">
                        <ClockIcon />
                        {timeAgo(issue.updated_at)}
                    </span>
                </div>
            </article>
        </Link>
    )
}

// ── helpers ─────────────────────────────────────────────────────────────

// firstParagraph is the body's lead — used as the muted summary above the
// excerpt box. Trimmed at the first blank line so multi-paragraph bodies
// don't overflow the tile.
function firstParagraph(body: string | null | undefined): string | null {
    if (!body) return null
    const trimmed = body.trim()
    if (!trimmed) return null
    const blank = trimmed.search(/\n\s*\n/)
    return blank === -1 ? trimmed : trimmed.slice(0, blank).trim()
}

// bodyExcerpt is the soft-bg quoted block. Picks the second paragraph if
// present (so it complements the lead instead of repeating it); falls back
// to a tail truncation of the lead when the body is a single paragraph.
function bodyExcerpt(body: string | null | undefined, lead: string): string | null {
    if (!body) return null
    const trimmed = body.trim()
    const blank = trimmed.search(/\n\s*\n/)
    if (blank === -1) {
        if (lead.length <= 80) return null
        return truncate(lead.slice(80), 220)
    }
    return truncate(trimmed.slice(blank).trim(), 220)
}

function truncate(s: string, n: number): string {
    if (s.length <= n) return s
    return s.slice(0, n).trimEnd() + "…"
}

// timeAgo renders the smallest reasonable relative time — same shape as
// the suggestions panel uses.
function timeAgo(iso: string): string {
    const ms = Date.now() - new Date(iso).getTime()
    const s = Math.round(ms / 1000)
    if (s < 60) return `${s}s ago`
    const m = Math.round(s / 60)
    if (m < 60) return `${m}m ago`
    const h = Math.round(m / 60)
    if (h < 24) return `${h}h ago`
    const d = Math.round(h / 24)
    if (d < 30) return `${d}d ago`
    return new Date(iso).toLocaleDateString()
}

// ExcerptBox renders the body preview inside the soft-bg card matching the
// reference. Highlights {curly_var} placeholders in the indigo accent.
function ExcerptBox({ text }: { text: string }) {
    const parts = text.split(/(\{[^}]+\})/g)
    return (
        <div className="rounded-[12px] border border-[color:var(--c-border)] bg-[color:var(--c-surface-2)] px-3 py-2 text-[12.5px] leading-5 text-[color:var(--c-text)]">
            {parts.map((p, i) =>
                /^\{[^}]+\}$/.test(p) ? (
                    <span
                        key={i}
                        className="rounded bg-indigo-100 px-1 py-[1px] font-semibold text-indigo-800"
                    >
                        {p}
                    </span>
                ) : (
                    <span key={i}>{p}</span>
                ),
            )}
        </div>
    )
}

// ── inline icons ────────────────────────────────────────────────────────
function Dot() {
    return (
        <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <circle cx="12" cy="12" r="4" />
        </svg>
    )
}
function IssueIcon() {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <circle cx="12" cy="12" r="9" />
            <path d="M12 8v5M12 16h0" />
        </svg>
    )
}
function ClockIcon() {
    return (
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" />
        </svg>
    )
}
function DotsIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <circle cx="6" cy="12" r="1.6" />
            <circle cx="12" cy="12" r="1.6" />
            <circle cx="18" cy="12" r="1.6" />
        </svg>
    )
}
