import { cn } from "@/components/cn"
import type { IssuePriority, IssueStatus } from "@/lib/supabase/types"
import { PRIORITY_META, STATUS_META } from "@/components/issue-meta"

// Minimal inline chips — a coloured dot + label. Status carries a soft
// tinted background; priority stays neutral-bordered so the two read as
// distinct registers without shouting.
export function StatusChip({ status }: { status: IssueStatus }) {
    const m = STATUS_META[status]
    return (
        <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-[2px] text-[11px] font-semibold", m.chip)}>
            <span className={cn("h-1.5 w-1.5 rounded-full", m.dot)} />
            {m.label}
        </span>
    )
}

export function PriorityChip({ priority }: { priority: IssuePriority }) {
    const m = PRIORITY_META[priority]
    return (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--c-border)] bg-white px-2 py-[2px] text-[11px] font-semibold text-[color:var(--c-text-muted)]">
            <span className={cn("h-1.5 w-1.5 rounded-full", m.dot)} />
            {m.label}
        </span>
    )
}
