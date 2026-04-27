import { cn } from "@/components/cn"
import type { IssuePriority, IssueStatus } from "@/lib/supabase/types"

const STATUS_STYLES: Record<IssueStatus, string> = {
    open:        "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
    in_progress: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
    blocked:     "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
    done:        "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300",
    archived:    "bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400",
}

const PRIORITY_STYLES: Record<IssuePriority, string> = {
    low:    "bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400",
    medium: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
    high:   "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300",
    urgent: "bg-red-200 text-red-900 dark:bg-red-900 dark:text-red-200",
}

export function StatusChip({ status }: { status: IssueStatus }) {
    return (
        <span className={cn("inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium", STATUS_STYLES[status])}>
            {status.replace(/_/g, " ")}
        </span>
    )
}

export function PriorityChip({ priority }: { priority: IssuePriority }) {
    return (
        <span className={cn("inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium", PRIORITY_STYLES[priority])}>
            {priority}
        </span>
    )
}
