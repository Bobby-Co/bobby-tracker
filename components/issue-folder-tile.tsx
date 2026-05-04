"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"
import type { Issue } from "@/lib/supabase/types"
import { IssueTile } from "@/components/issue-tile"
import { StatusChip } from "@/components/status-chip"
import { Modal } from "@/components/modal"

// Tile-view counterpart to the list view's parent-with-children
// row. The parent tile is rendered with a "stack of papers"
// decoration behind it (two offset card backdrops) so it visually
// reads as a folder rather than a single tile. A footer affordance
// shows the duplicate count and opens a modal listing each
// duplicate as a compact row that links to its detail page.
//
// We deliberately don't expand inline — CSS grid would push
// neighboring tiles around, and this card already pulls a lot of
// visual weight as a folder. The modal keeps the grid stable and
// gives duplicates a clean read.
export function IssueFolderTile({
    parent,
    duplicates,
    projectId,
    index,
}: {
    parent: Issue
    duplicates: Issue[]
    projectId: string
    index?: number
}) {
    const router = useRouter()
    const [open, setOpen] = useState(false)
    const count = duplicates.length

    return (
        <>
            {/*
                Wrapper visually stitches the parent tile + the
                amber footer into one folder element:
                  - [&_.card]:rounded-b-none flattens the inner tile's
                    bottom corners so the footer can dock under them.
                  - [&_.card-stack:hover]:!transform-none suppresses
                    IssueTile's own hover lift, so the lift only
                    happens once at the wrapper level — that way the
                    footer rises in sync with the tile body.
                  - The wrapper itself lifts on :hover (fires for any
                    descendant hover) so card + footer move together.
            */}
            <div
                className="relative anim-rise transition-transform hover:-translate-y-px [&_.card]:rounded-b-none [&_.card-stack:hover]:transform-none!"
                style={index != null ? ({ ["--i" as string]: index } as React.CSSProperties) : undefined}
            >
                {/* Bottom-only "ledges" suggesting a stack of papers
                    underneath the tile. Earlier we used full-height
                    backdrops with their top inside the wrapper — the
                    .card-tab only takes its content width (self-start),
                    so the empty area beside it leaked the backdrop's
                    top edge. These are short strips anchored to the
                    wrapper bottom, so there's no top to leak. They
                    sit half above (covered by the footer's amber bg)
                    and half below (the visible peek). */}
                <div
                    aria-hidden
                    className="pointer-events-none absolute left-[10px] right-[10px] bottom-[-6px] h-[12px] rounded-b-[14px] border border-t-0 border-[color:var(--c-border-strong)] bg-white shadow-[0_2px_6px_-2px_rgba(15,23,42,0.10)]"
                />
                <div
                    aria-hidden
                    className="pointer-events-none absolute left-[5px] right-[5px] bottom-[-3px] h-[8px] rounded-b-[15px] border border-t-0 border-[color:var(--c-border-strong)] bg-white shadow-[0_2px_6px_-2px_rgba(15,23,42,0.08)]"
                />

                {/* Parent tile renders normally — index passed as 0
                    so its own anim-rise stagger doesn't double up
                    with the wrapper's. `relative` so it paints above
                    the absolutely-positioned backdrops above. */}
                <div className="relative">
                    <IssueTile issue={parent} projectId={projectId} index={0} />
                </div>

                {/* Folder footer, docked to the tile's bottom edge:
                    border-t-0 + matching border colour avoid a double
                    line where they meet, rounded-b-[16px] mirrors the
                    tile's original radius. Outside the IssueTile's
                    Link so it can be its own click target without
                    nesting a button inside an <a>. */}
                <button
                    type="button"
                    onClick={() => setOpen(true)}
                    aria-label={`Show ${count} duplicate${count === 1 ? "" : "s"}`}
                    className="relative flex w-full items-center justify-between gap-2 rounded-b-[16px] border border-t-0 border-[color:var(--c-border)] bg-amber-50 px-3 py-2 text-[11.5px] font-semibold text-amber-900 transition-colors hover:bg-amber-100"
                >
                    <span className="inline-flex items-center gap-1.5">
                        <FolderIcon />
                        {count} duplicate{count === 1 ? "" : "s"} inside
                    </span>
                    <span aria-hidden className="text-[10.5px] uppercase tracking-[0.08em] opacity-80">
                        View
                    </span>
                </button>
            </div>

            <Modal
                open={open}
                onClose={() => setOpen(false)}
                title={`#${parent.issue_number} · ${count} duplicate${count === 1 ? "" : "s"}`}
                description="These reports were marked as duplicates of this issue. Click one to open its detail page."
                size="md"
            >
                <div className="flex flex-col gap-3">
                    <div className="rounded-[12px] border border-[color:var(--c-border)] bg-[color:var(--c-surface-2)] p-3">
                        <div className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-[color:var(--c-text-muted)]">
                            Original
                        </div>
                        <Link
                            href={`/projects/${projectId}/issues/${parent.id}`}
                            onClick={() => setOpen(false)}
                            className="mt-1 flex items-center gap-2 text-[13px] font-semibold hover:underline"
                        >
                            <span className="font-mono text-[11px] text-[color:var(--c-text-dim)]">
                                #{parent.issue_number}
                            </span>
                            <span className="min-w-0 flex-1 truncate">{parent.title}</span>
                            <StatusChip status={parent.status} />
                        </Link>
                    </div>

                    <div>
                        <div className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-[color:var(--c-text-muted)]">
                            Duplicates
                        </div>
                        <ul className="mt-1.5 flex flex-col gap-1.5">
                            {duplicates.map((d) => (
                                <li key={d.id}>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setOpen(false)
                                            router.push(`/projects/${projectId}/issues/${d.id}`)
                                        }}
                                        className="group flex w-full items-center gap-2 rounded-[10px] border border-[color:var(--c-border)] bg-white px-3 py-2 text-left text-[12.5px] transition-colors hover:bg-[color:var(--c-surface-2)]"
                                    >
                                        <span className="font-mono text-[11px] text-[color:var(--c-text-dim)]">
                                            #{d.issue_number}
                                        </span>
                                        <span className="min-w-0 flex-1 truncate text-[color:var(--c-text-muted)] transition-transform group-hover:translate-x-px">
                                            {d.title}
                                        </span>
                                        <StatusChip status={d.status} />
                                    </button>
                                </li>
                            ))}
                        </ul>
                    </div>
                </div>
            </Modal>
        </>
    )
}

function FolderIcon() {
    return (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
        </svg>
    )
}
