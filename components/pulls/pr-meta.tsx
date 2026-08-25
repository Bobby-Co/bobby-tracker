import { cn } from "@/components/ui/cn"
import type { PullRequest, PullRequestAnalysis } from "@/lib/shared/types"
import { PullRequest as PullRequestEntity } from "@/modules/vcs/domain/PullRequest"

// Single source of truth for how a PR's state + Bobby's review status read
// across the Pull-requests surfaces (list rows, detail header) — mirrors the
// role of components/issues/issue-meta.tsx.

// The four display states, collapsed from (state, merged, draft):
export type PrState = "open" | "draft" | "merged" | "closed"

export function prState(pr: Pick<PullRequest, "state" | "merged" | "draft">): PrState {
    return PullRequestEntity.of(pr).lifecycle()
}

export const PR_STATE_META: Record<PrState, { dot: string; chip: string; label: string }> = {
    open:   { dot: "bg-emerald-500", chip: "bg-emerald-50 text-emerald-700", label: "Open" },
    draft:  { dot: "bg-[color:var(--c-border-strong)]",    chip: "bg-[color:var(--c-surface-2)] text-[color:var(--c-text-muted)]",      label: "Draft" },
    merged: { dot: "bg-violet-500",  chip: "bg-violet-50 text-violet-700",   label: "Merged" },
    closed: { dot: "bg-rose-500",    chip: "bg-rose-50 text-rose-700",       label: "Closed" },
}

export function PrStateChip({ pr }: { pr: Pick<PullRequest, "state" | "merged" | "draft"> }) {
    const m = PR_STATE_META[prState(pr)]
    return (
        <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-[2px] text-[11px] font-semibold", m.chip)}>
            <span className={cn("h-1.5 w-1.5 rounded-full", m.dot)} />
            {m.label}
        </span>
    )
}

// Bobby's review status — a subtler register than the PR state chip. Null (never
// reviewed — e.g. a draft or a PR closed before review) renders nothing.
type ReviewStatus = PullRequestAnalysis["status"]

export const REVIEW_META: Record<Exclude<ReviewStatus, null>, { dot: string; chip: string; label: string }> = {
    queued:    { dot: "bg-amber-400",               chip: "bg-amber-50 text-amber-700",   label: "Queued" },
    analysing: { dot: "bg-amber-500 animate-pulse", chip: "bg-amber-50 text-amber-700",   label: "Reviewing" },
    done:      { dot: "bg-emerald-500",             chip: "bg-emerald-50 text-emerald-700", label: "Reviewed" },
    failed:    { dot: "bg-rose-500",                chip: "bg-rose-50 text-rose-700",       label: "Review failed" },
    cancelled: { dot: "bg-[color:var(--c-border-strong)]",                chip: "bg-[color:var(--c-surface-2)] text-[color:var(--c-text-muted)]",      label: "Review cancelled" },
}

export function ReviewChip({ status }: { status: ReviewStatus }) {
    if (!status) return null
    const m = REVIEW_META[status]
    return (
        <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-[2px] text-[11px] font-semibold", m.chip)}>
            <span className={cn("h-1.5 w-1.5 rounded-full", m.dot)} />
            {m.label}
        </span>
    )
}
