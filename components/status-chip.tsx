import { cn } from "@/components/cn"
import type { IssuePriority, IssueStatus } from "@/lib/supabase/types"

const STATUS_STYLES: Record<IssueStatus, string> = {
    open:        "bg-blue-50 text-blue-800 border-blue-100",
    in_progress: "bg-amber-50 text-amber-800 border-amber-100",
    blocked:     "bg-red-50 text-red-800 border-red-100",
    done:        "bg-emerald-50 text-emerald-800 border-emerald-100",
    archived:    "bg-zinc-100 text-zinc-600 border-zinc-200",
    duplicated:  "bg-amber-50 text-amber-800 border-amber-100",
}

const PRIORITY_STYLES: Record<IssuePriority, string> = {
    low:    "bg-zinc-50 text-zinc-600 border-zinc-200",
    medium: "bg-zinc-100 text-zinc-700 border-zinc-200",
    high:   "bg-orange-50 text-orange-800 border-orange-100",
    urgent: "bg-rose-50 text-rose-800 border-rose-100",
}

export function StatusChip({ status }: { status: IssueStatus }) {
    return (
        <span className={cn("inline-flex items-center rounded-full border px-2 py-[2px] text-[11px] font-semibold", STATUS_STYLES[status])}>
            {status.replace(/_/g, " ")}
        </span>
    )
}

export function PriorityChip({ priority }: { priority: IssuePriority }) {
    return (
        <span className={cn("inline-flex items-center rounded-full border px-2 py-[2px] text-[11px] font-semibold", PRIORITY_STYLES[priority])}>
            {priority}
        </span>
    )
}
