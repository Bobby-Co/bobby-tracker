import Link from "next/link"
import { cn } from "@/components/cn"
import { PriorityChip } from "@/components/status-chip"
import type { Issue, IssueStatus } from "@/lib/supabase/types"

const STATUS_TAB: Record<IssueStatus, { tab: string; label: string }> = {
    open:        { tab: "card-tab-action",  label: "Open" },
    in_progress: { tab: "card-tab-trigger", label: "In progress" },
    blocked:     { tab: "card-tab-rose",    label: "Blocked" },
    done:        { tab: "card-tab-output",  label: "Done" },
    archived:    { tab: "card-tab-muted",   label: "Archived" },
}

// IssueTile matches the workflow-card pattern from the CI reference image
// (Send Email / Anthropic cards): folder-tab status, title row with icon
// + ⋮, optional 1-line summary, soft-bg body excerpt with {var}
// highlighting, pill row with priority + labels, footer with #number +
// time-ago.
export function IssueTile({ issue, projectId, index }: { issue: Issue; projectId: string; index?: number }) {
    const { tab, label } = STATUS_TAB[issue.status]
    const summary = leadLine(issue.body)
    const excerpt = bodyExcerpt(issue.body, summary)
    const labels = issue.labels.slice(0, 2)
    const moreLabels = Math.max(0, issue.labels.length - labels.length)

    return (
        <Link
            href={`/projects/${projectId}/issues/${issue.id}`}
            className="group block focus:outline-none"
            tabIndex={0}
        >
            <div
                className="card-stack anim-rise"
                style={index != null ? ({ ["--i" as string]: index } as React.CSSProperties) : undefined}
            >
                <span className={cn("card-tab", tab)}>
                    <Dot /> {label}
                </span>
                <article className="card card-hover flex flex-1 flex-col">
                    <div className="card-title">
                        <IssueIcon />
                        <span className="line-clamp-2 min-w-0 leading-snug">{issue.title}</span>
                        <span className="card-menu-btn" aria-hidden>
                            <DotsIcon />
                        </span>
                    </div>

                    {summary && (
                        <p className="mt-2 line-clamp-2 text-[12.5px] leading-5 text-[color:var(--c-text-muted)]">
                            {summary}
                        </p>
                    )}

                    {excerpt && <ExcerptBox className="mt-2.5" text={excerpt} />}

                    {(labels.length > 0 || moreLabels > 0) && (
                        <div className="mt-3 flex flex-wrap items-center gap-1.5">
                            <PriorityPill priority={issue.priority} />
                            {labels.map((l) => (
                                <span
                                    key={l}
                                    className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--c-border)] bg-white px-2 py-[3px] text-[11px] font-semibold text-[color:var(--c-text-muted)]"
                                >
                                    <LabelDot />
                                    {l}
                                </span>
                            ))}
                            {moreLabels > 0 && (
                                <span className="text-[11px] text-[color:var(--c-text-dim)]">+{moreLabels}</span>
                            )}
                        </div>
                    )}
                    {labels.length === 0 && moreLabels === 0 && (
                        <div className="mt-3">
                            <PriorityPill priority={issue.priority} />
                        </div>
                    )}

                    <div className="card-footer mt-auto pt-3">
                        <ClockIcon />
                        <span>{timeAgo(issue.updated_at)}</span>
                        <span className="ml-auto font-mono text-[11px] text-[color:var(--c-text-dim)]">
                            #{issue.issue_number}
                        </span>
                    </div>
                </article>
            </div>
        </Link>
    )
}

// PriorityPill matches the Postmark/Claude pill pattern from the reference
// — tiny coloured icon-tile + label inside a bordered pill.
function PriorityPill({ priority }: { priority: Issue["priority"] }) {
    const cfg = {
        low:    { bg: "bg-zinc-100",   fg: "text-zinc-600",   icon: "P" },
        medium: { bg: "bg-zinc-200",   fg: "text-zinc-700",   icon: "P" },
        high:   { bg: "bg-orange-200", fg: "text-orange-900", icon: "P" },
        urgent: { bg: "bg-rose-300",   fg: "text-rose-900",   icon: "P" },
    }[priority]
    return (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--c-border)] bg-white px-2 py-[3px] text-[11px] font-semibold text-[color:var(--c-text)]">
            <span className={cn("grid h-[14px] w-[14px] place-items-center rounded-[4px] text-[9px] font-extrabold", cfg.bg, cfg.fg)}>
                {cfg.icon}
            </span>
            {priority}
        </span>
    )
}

// Use the upstream PriorityChip if it ever needs to differ; the local
// pill above tracks the reference's icon-tile-in-pill pattern.
void PriorityChip

// ── helpers ─────────────────────────────────────────────────────────────

function leadLine(body: string | null | undefined): string | null {
    if (!body) return null
    const trimmed = body.trim()
    if (!trimmed) return null
    const newline = trimmed.indexOf("\n")
    const head = newline === -1 ? trimmed : trimmed.slice(0, newline).trim()
    return head || null
}

// bodyExcerpt picks the most informative snippet for the soft-bg box. If
// the body has more than just the lead line, return the rest (truncated).
// Otherwise return null — we'd rather skip the box than echo the lead.
function bodyExcerpt(body: string | null | undefined, lead: string | null): string | null {
    if (!body) return null
    const trimmed = body.trim()
    if (!trimmed) return null
    if (lead && trimmed === lead) return null
    const after = lead ? trimmed.slice(lead.length).trim() : trimmed
    if (!after) return null
    return truncate(after, 200)
}

function truncate(s: string, n: number): string {
    if (s.length <= n) return s
    return s.slice(0, n).trimEnd() + "…"
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
    if (d < 30) return `${d}d ago`
    return new Date(iso).toLocaleDateString()
}

function ExcerptBox({ text, className }: { text: string; className?: string }) {
    const parts = text.split(/(\{[^}]+\})/g)
    return (
        <div
            className={cn(
                "rounded-[12px] border border-[color:var(--c-border)] bg-[color:var(--c-surface-2)] px-3 py-2 text-[12.5px] leading-5 text-[color:var(--c-text)]",
                className,
            )}
        >
            <span className="line-clamp-3 break-words">
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
            </span>
        </div>
    )
}

// ── inline icons ────────────────────────────────────────────────────────
function Dot() {
    return (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <circle cx="12" cy="12" r="6" />
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
function LabelDot() {
    return (
        <svg width="6" height="6" viewBox="0 0 6 6" fill="currentColor" aria-hidden className="text-[color:var(--c-text-dim)]">
            <circle cx="3" cy="3" r="3" />
        </svg>
    )
}
