"use client"

import Link from "next/link"
import { useState } from "react"
import type { Issue } from "@/lib/supabase/types"
import { PriorityChip, StatusChip } from "@/components/status-chip"

// Hierarchical list view of issues. Each top-level issue is its own
// rounded card (visually separated from siblings, not stitched
// together with a shared divider). When the issue has duplicates,
// they live inside the parent's card under an expandable subtree —
// this keeps the parent ↔ duplicates relationship visually
// contained without bleeding across cards.
//
// Tile view stays a flat grid; duplicates are filtered out of it
// upstream so they don't show as standalone tiles.
export interface ParentRow {
    parent: Issue
    children: Issue[]
}

export function IssueList({
    projectId,
    parents,
    muted,
}: {
    projectId: string
    parents: ParentRow[]
    muted?: boolean
}) {
    return (
        <div className={"flex flex-col gap-2" + (muted ? " opacity-90" : "")}>
            {parents.map(({ parent, children }) => (
                <ParentCard
                    key={parent.id}
                    parent={parent}
                    duplicates={children}
                    projectId={projectId}
                    muted={muted}
                />
            ))}
        </div>
    )
}

function ParentCard({
    parent, duplicates, projectId, muted,
}: {
    parent: Issue
    duplicates: Issue[]
    projectId: string
    muted?: boolean
}) {
    const [open, setOpen] = useState(false)
    const hasChildren = duplicates.length > 0

    return (
        <div
            className={
                "overflow-hidden rounded-[12px] border border-[color:var(--c-border)] bg-white shadow-[var(--shadow-card)]" +
                (muted ? " opacity-80" : "")
            }
        >
            <div className="group flex items-center gap-2 pl-1.5 pr-2 transition-colors hover:bg-[color:var(--c-surface-2)] sm:gap-2.5 sm:pr-3">
                {hasChildren ? (
                    <button
                        type="button"
                        onClick={() => setOpen((o) => !o)}
                        aria-expanded={open}
                        aria-label={open ? "Collapse duplicates" : "Expand duplicates"}
                        className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-[color:var(--c-text-dim)] hover:bg-white hover:text-[color:var(--c-text)]"
                    >
                        <svg
                            width="11"
                            height="11"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            aria-hidden
                            className={"transition-transform " + (open ? "rotate-90" : "")}
                        >
                            <path d="M9 6l6 6-6 6" />
                        </svg>
                    </button>
                ) : (
                    <span className="hidden h-7 w-7 shrink-0 sm:block" />
                )}

                <Link
                    href={`/projects/${projectId}/issues/${parent.id}`}
                    className="flex min-w-0 flex-1 items-center gap-2 py-2.5 sm:gap-3"
                >
                    <span className="hidden shrink-0 font-mono text-[11.5px] text-[color:var(--c-text-dim)] transition-colors group-hover:text-[color:var(--c-text-muted)] sm:inline">
                        #{parent.issue_number}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium transition-transform group-hover:translate-x-px">
                        <span className="mr-1.5 font-mono text-[11px] text-[color:var(--c-text-dim)] sm:hidden">
                            #{parent.issue_number}
                        </span>
                        {parent.title}
                    </span>
                    {/*
                        Right-side meta cluster. Chips are progressive:
                        the status chip is always shown, the rest only
                        appear when there's room. min-w-0 + flex-shrink
                        on this cluster lets the title win when space
                        gets tight, instead of pushing chips off-card.
                    */}
                    <div className="flex min-w-0 shrink items-center justify-end gap-1.5">
                        {hasChildren && (
                            <span
                                className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10.5px] font-bold text-amber-900 tabular-nums"
                                title={`${duplicates.length} duplicate${duplicates.length === 1 ? "" : "s"}`}
                            >
                                +{duplicates.length}
                            </span>
                        )}
                        {parent.labels.slice(0, 1).map((l) => (
                            <span
                                key={l}
                                className="hidden max-w-[140px] truncate rounded-full border border-[color:var(--c-border)] bg-[color:var(--c-surface-2)] px-2 py-[2px] text-[11px] font-semibold text-[color:var(--c-text-muted)] xl:inline"
                            >
                                {l}
                            </span>
                        ))}
                        <span className="hidden md:inline shrink-0">
                            <PriorityChip priority={parent.priority} />
                        </span>
                        <span className="shrink-0">
                            <StatusChip status={parent.status} />
                        </span>
                    </div>
                </Link>
            </div>

            {hasChildren && open && (
                <ul className="border-t border-dashed border-[color:var(--c-border)] bg-[color:var(--c-surface-2)]/40">
                    {duplicates.map((c) => (
                        <li key={c.id}>
                            <Link
                                href={`/projects/${projectId}/issues/${c.id}`}
                                className="group flex items-center gap-2 pl-9 pr-2 py-2 text-[12.5px] transition-colors hover:bg-white sm:gap-3 sm:pl-12 sm:pr-3"
                            >
                                <span className="hidden shrink-0 font-mono text-[11px] text-[color:var(--c-text-dim)] sm:inline">
                                    #{c.issue_number}
                                </span>
                                <span className="min-w-0 flex-1 truncate text-[color:var(--c-text-muted)] transition-transform group-hover:translate-x-px">
                                    <span className="mr-1.5 font-mono text-[10.5px] text-[color:var(--c-text-dim)] sm:hidden">
                                        #{c.issue_number}
                                    </span>
                                    {c.title}
                                </span>
                                <span className="shrink-0">
                                    <StatusChip status={c.status} />
                                </span>
                            </Link>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    )
}
