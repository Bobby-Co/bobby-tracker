import type { IssuePriority, IssueStatus } from "@/lib/supabase/types"
import type { Tone } from "@/components/field-card"
import { cn } from "@/components/cn"

// Single source of truth for how an issue's status / priority reads
// across every surface — the circular card glyph, the field-table value
// rows, and the inline chips. Keeps colour + label vocabulary in one
// place so the minimal redesign stays consistent.

export const STATUS_META: Record<
    IssueStatus,
    { tone: Tone; dot: string; chip: string; label: string }
> = {
    open:        { tone: "blue",    dot: "bg-blue-500",    chip: "bg-blue-50 text-blue-700",       label: "Open" },
    in_progress: { tone: "amber",   dot: "bg-amber-500",   chip: "bg-amber-50 text-amber-700",     label: "In progress" },
    blocked:     { tone: "rose",    dot: "bg-rose-500",    chip: "bg-rose-50 text-rose-700",       label: "Blocked" },
    done:        { tone: "emerald", dot: "bg-emerald-500", chip: "bg-emerald-50 text-emerald-700", label: "Done" },
    archived:    { tone: "zinc",    dot: "bg-zinc-400",    chip: "bg-zinc-100 text-zinc-600",      label: "Archived" },
    duplicated:  { tone: "violet",  dot: "bg-violet-500",  chip: "bg-violet-50 text-violet-700",   label: "Duplicated" },
}

export const PRIORITY_META: Record<IssuePriority, { dot: string; label: string }> = {
    low:    { dot: "bg-zinc-300",   label: "Low" },
    medium: { dot: "bg-sky-400",    label: "Medium" },
    high:   { dot: "bg-orange-400", label: "High" },
    urgent: { dot: "bg-rose-500",   label: "Urgent" },
}

// Value renderers for use inside a <FieldRow> — a coloured dot + label.
export function StatusValue({ status }: { status: IssueStatus }) {
    const m = STATUS_META[status]
    return (
        <>
            <span className={cn("h-2 w-2 shrink-0 rounded-full", m.dot)} />
            {m.label}
        </>
    )
}

export function PriorityValue({ priority }: { priority: IssuePriority }) {
    const m = PRIORITY_META[priority]
    return (
        <>
            <span className={cn("h-2 w-2 shrink-0 rounded-full", m.dot)} />
            {m.label}
        </>
    )
}

// Circular-glyph contents for a status-tinted <MiniIcon>.
export function StatusGlyph({ status }: { status: IssueStatus }) {
    switch (status) {
        case "done":
            return (
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M20 6 9 17l-5-5" />
                </svg>
            )
        case "blocked":
            return (
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <circle cx="12" cy="12" r="9" />
                    <path d="M5.6 5.6l12.8 12.8" />
                </svg>
            )
        case "in_progress":
            return (
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <circle cx="12" cy="12" r="9" />
                    <path d="M12 12V7" />
                    <path d="M12 12l4 2.5" />
                </svg>
            )
        case "archived":
            return (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <rect x="3" y="4" width="18" height="5" rx="1.5" />
                    <path d="M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9M10 13h4" />
                </svg>
            )
        case "duplicated":
            return (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <rect x="9" y="9" width="11" height="11" rx="2" />
                    <path d="M5 15V5a2 2 0 0 1 2-2h10" />
                </svg>
            )
        default:
            return (
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <circle cx="12" cy="12" r="9" />
                    <circle cx="12" cy="12" r="3.2" fill="currentColor" stroke="none" />
                </svg>
            )
    }
}

// ── shared time / date helpers ──────────────────────────────────────────
export function timeAgo(iso: string): string {
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

export function shortDate(iso: string): string {
    return new Date(iso).toLocaleDateString(undefined, {
        month: "short",
        day: "2-digit",
        year: "numeric",
    })
}
