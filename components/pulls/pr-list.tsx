"use client"

import Link from "next/link"
import type { PullRequest, PullRequestAnalysis } from "@/lib/supabase/types"
import { cn } from "@/components/ui/cn"
import { PrStateChip, ReviewChip, PR_STATE_META, prState } from "@/components/pulls/pr-meta"

// A mirrored PR plus its overlaid review status (shape returned by
// GET /api/projects/[id]/pulls).
export type PullRequestRow = PullRequest & { review_status: PullRequestAnalysis["status"] }

// Flat list of PR rows — the same bordered-card row language as the issues list
// (components/issues/issue-list.tsx), minus the duplicates subtree PRs don't have.
export function PrList({ projectId, pulls, muted }: { projectId: string; pulls: PullRequestRow[]; muted?: boolean }) {
    return (
        <div className={"flex flex-col gap-2" + (muted ? " opacity-90" : "")}>
            {pulls.map((pr) => (
                <PrRow key={pr.id} pr={pr} projectId={projectId} muted={muted} />
            ))}
        </div>
    )
}

function PrRow({ pr, projectId, muted }: { pr: PullRequestRow; projectId: string; muted?: boolean }) {
    const state = prState(pr)
    return (
        <div
            className={
                "flex items-center gap-2 overflow-hidden rounded-[12px] border border-[color:var(--c-border)] bg-white pl-2 pr-2 shadow-[var(--shadow-card)] transition-colors hover:bg-[color:var(--c-surface-2)] sm:gap-2.5 sm:pl-3 sm:pr-3" +
                (muted ? " opacity-80" : "")
            }
        >
            <Link
                href={`/projects/${projectId}/pulls/${pr.pr_number}`}
                prefetch={false}
                className="group flex min-w-0 flex-1 items-center gap-2 py-2.5 sm:gap-3"
            >
                <span
                    className={cn("h-2 w-2 shrink-0 rounded-full", PR_STATE_META[state].dot)}
                    title={PR_STATE_META[state].label}
                    aria-hidden
                />
                <span className="hidden shrink-0 font-mono text-[11.5px] text-[color:var(--c-text-dim)] transition-colors group-hover:text-[color:var(--c-text-muted)] sm:inline">
                    #{pr.pr_number}
                </span>
                <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium transition-transform group-hover:translate-x-px">
                    <span className="mr-1.5 font-mono text-[11px] text-[color:var(--c-text-dim)] sm:hidden">
                        #{pr.pr_number}
                    </span>
                    {pr.title}
                </span>
                <div className="flex min-w-0 shrink items-center justify-end gap-1.5">
                    {pr.base_ref && (
                        <span className="hidden max-w-[180px] items-center gap-1 truncate rounded-full border border-[color:var(--c-border)] bg-[color:var(--c-surface-2)] px-2 py-[2px] font-mono text-[10.5px] text-[color:var(--c-text-muted)] xl:inline-flex">
                            {pr.head_ref} → {pr.base_ref}
                        </span>
                    )}
                    <span className="hidden shrink-0 md:inline">
                        <ReviewChip status={pr.review_status} />
                    </span>
                    <span className="shrink-0">
                        <PrStateChip pr={pr} />
                    </span>
                </div>
            </Link>
        </div>
    )
}
