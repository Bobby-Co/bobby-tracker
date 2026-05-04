"use client"

import Link from "next/link"
import { useState } from "react"
import type { Issue } from "@/lib/supabase/types"
import { PriorityChip, StatusChip } from "@/components/status-chip"

// Hierarchical list view of issues. Top-level rows are issues that
// aren't themselves duplicates; each carries its own children
// (issues whose duplicate_of_issue_id points at it). Children are
// indented underneath their parent and hidden by default — a
// chevron + count toggles them. Collapse state lives client-side
// per parent (in-memory; resets on navigation, which keeps the URL
// the source of truth and avoids stale localStorage).
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
        <ul
            className={
                "overflow-hidden rounded-[16px] border border-[color:var(--c-border)] bg-white shadow-[var(--shadow-card)] divide-y divide-[color:var(--c-border)]" +
                (muted ? " opacity-90" : "")
            }
        >
            {parents.map(({ parent, children }) => (
                <ParentLi
                    key={parent.id}
                    parent={parent}
                    duplicates={children}
                    projectId={projectId}
                    muted={muted}
                />
            ))}
        </ul>
    )
}

function ParentLi({
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
        <li className={muted ? "opacity-70" : undefined}>
            <div className="group flex items-center gap-2.5 pl-1 pr-3 py-1 transition-colors hover:bg-[color:var(--c-surface-2)] sm:gap-3 sm:pr-4">
                {hasChildren ? (
                    <button
                        type="button"
                        onClick={() => setOpen((o) => !o)}
                        aria-expanded={open}
                        aria-label={open ? "Collapse duplicates" : "Expand duplicates"}
                        className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-[color:var(--c-text-dim)] hover:bg-white hover:text-[color:var(--c-text)]"
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
                    <span className="hidden h-6 w-6 shrink-0 sm:block" />
                )}

                <Link
                    href={`/projects/${projectId}/issues/${parent.id}`}
                    className="flex min-w-0 flex-1 items-center gap-2.5 py-2 sm:gap-3"
                >
                    <span className="hidden font-mono text-[11.5px] text-[color:var(--c-text-dim)] transition-colors group-hover:text-[color:var(--c-text-muted)] sm:inline">
                        #{parent.issue_number}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium transition-transform group-hover:translate-x-px">
                        <span className="mr-1.5 font-mono text-[11px] text-[color:var(--c-text-dim)] sm:hidden">
                            #{parent.issue_number}
                        </span>
                        {parent.title}
                    </span>
                    <div className="flex shrink-0 items-center gap-1.5">
                        {hasChildren && (
                            <span
                                className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10.5px] font-bold text-amber-900 tabular-nums"
                                title={`${duplicates.length} duplicate${duplicates.length === 1 ? "" : "s"}`}
                            >
                                +{duplicates.length}
                            </span>
                        )}
                        {parent.labels.slice(0, 3).map((l) => (
                            <span
                                key={l}
                                className="hidden rounded-full border border-[color:var(--c-border)] bg-[color:var(--c-surface-2)] px-2 py-[2px] text-[11px] font-semibold text-[color:var(--c-text-muted)] md:inline"
                            >
                                {l}
                            </span>
                        ))}
                        <span className="hidden sm:inline">
                            <PriorityChip priority={parent.priority} />
                        </span>
                        <StatusChip status={parent.status} />
                    </div>
                </Link>
            </div>

            {hasChildren && open && (
                <ul className="border-t border-dashed border-[color:var(--c-border)] bg-[color:var(--c-surface-2)]/50">
                    {duplicates.map((c) => (
                        <li key={c.id}>
                            <Link
                                href={`/projects/${projectId}/issues/${c.id}`}
                                className="group flex items-center gap-2.5 pl-9 pr-3 py-2 text-[12.5px] transition-colors hover:bg-white sm:gap-3 sm:pl-12 sm:pr-4"
                            >
                                <span className="hidden font-mono text-[11px] text-[color:var(--c-text-dim)] sm:inline">
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
        </li>
    )
}
