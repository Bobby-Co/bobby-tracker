"use client"

import Link from "next/link"
import { useState } from "react"
import type { Issue } from "@/lib/supabase/types"
import { PriorityChip, StatusChip } from "@/components/status-chip"

// Hierarchical list view of issues.
//
// Layout shape:
//   - Each issue is its own bordered card with a small gap between
//     siblings — no shared dividers.
//   - Issues without duplicates render edge-to-edge; only issues
//     that *have* duplicates carry a chevron + count badge.
//   - When expanded, duplicate children render as their own cards
//     stacked underneath the parent and indented from the left to
//     signal subordination.
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
                <ParentBlock
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

function ParentBlock({
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
        <div className="flex flex-col gap-1.5">
            <ParentRowCard
                parent={parent}
                duplicates={duplicates}
                projectId={projectId}
                muted={muted}
                open={open}
                onToggle={() => setOpen((o) => !o)}
            />
            {hasChildren && open && (
                <div className="flex flex-col gap-1.5 border-l-2 border-amber-200 pl-3 ml-3 sm:pl-4 sm:ml-5">
                    {duplicates.map((c) => (
                        <ChildRowCard key={c.id} child={c} projectId={projectId} muted={muted} />
                    ))}
                </div>
            )}
        </div>
    )
}

function ParentRowCard({
    parent, duplicates, projectId, muted, open, onToggle,
}: {
    parent: Issue
    duplicates: Issue[]
    projectId: string
    muted?: boolean
    open: boolean
    onToggle: () => void
}) {
    const hasChildren = duplicates.length > 0
    return (
        <div
            className={
                "flex items-center gap-2 overflow-hidden rounded-[12px] border border-[color:var(--c-border)] bg-white pl-2 pr-2 shadow-[var(--shadow-card)] transition-colors hover:bg-[color:var(--c-surface-2)] sm:gap-2.5 sm:pl-3 sm:pr-3" +
                (muted ? " opacity-80" : "")
            }
        >
            {hasChildren && (
                <button
                    type="button"
                    onClick={onToggle}
                    aria-expanded={open}
                    aria-label={open ? "Collapse duplicates" : "Expand duplicates"}
                    className="grid h-5 w-5 shrink-0 -mr-2 place-items-center rounded-md text-[color:var(--c-text-dim)] hover:bg-white hover:text-[color:var(--c-text)]"
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
            )}

            <Link
                href={`/projects/${projectId}/issues/${parent.id}`}
                className="group flex min-w-0 flex-1 items-center gap-2 py-2.5 sm:gap-3"
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
                    Right-side meta cluster. min-w-0 + shrink (without
                    shrink-0) lets the title win when space gets tight,
                    so chips stay inside the card instead of overflowing.
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
    )
}

function ChildRowCard({
    child, projectId, muted,
}: {
    child: Issue
    projectId: string
    muted?: boolean
}) {
    return (
        <Link
            href={`/projects/${projectId}/issues/${child.id}`}
            className={
                "group flex items-center gap-2 overflow-hidden rounded-[10px] border border-[color:var(--c-border)] bg-white px-3 py-2 text-[12.5px] shadow-sm transition-colors hover:bg-[color:var(--c-surface-2)] sm:gap-3 sm:px-3.5" +
                (muted ? " opacity-80" : "")
            }
        >
            <span className="hidden shrink-0 font-mono text-[11px] text-[color:var(--c-text-dim)] sm:inline">
                #{child.issue_number}
            </span>
            <span className="min-w-0 flex-1 truncate text-[color:var(--c-text-muted)] transition-transform group-hover:translate-x-px">
                <span className="mr-1.5 font-mono text-[10.5px] text-[color:var(--c-text-dim)] sm:hidden">
                    #{child.issue_number}
                </span>
                {child.title}
            </span>
            <span className="shrink-0">
                <StatusChip status={child.status} />
            </span>
        </Link>
    )
}
