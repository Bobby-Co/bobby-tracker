"use client"

// Dev-only preview of the LEGO board planning view with mock data,
// so the grid / drag / resize can be exercised without auth. Not
// linked from anywhere; safe to delete.

import { useState } from "react"
import { TimelineGrid } from "@/components/timeline/timeline-grid"
import type { Issue, IssueStatus, IssuePriority } from "@/lib/supabase/types"

const DAY = 24 * 60 * 60 * 1000

function midnight(offsetDays: number): string {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    d.setDate(d.getDate() + offsetDays)
    return d.toISOString()
}

let n = 0
function mk(
    title: string,
    status: IssueStatus,
    priority: IssuePriority,
    opts: { startDay?: number; days?: number; lane?: number; labels?: string[] } = {},
): Issue {
    n += 1
    const scheduled = opts.startDay !== undefined
    return {
        id: `mock-${n}`,
        project_id: "preview",
        user_id: "preview",
        title,
        body: "",
        status,
        priority,
        labels: opts.labels ?? [],
        github_issue_number: null,
        github_node_id: null,
        issue_number: 100 + n,
        ai_proposed: false,
        duplicate_of_issue_id: null,
        starts_at: scheduled ? midnight(opts.startDay!) : null,
        ends_at: scheduled ? midnight(opts.startDay! + (opts.days ?? 1)) : null,
        lane_y: scheduled ? (opts.lane ?? 0) : null,
        color: null,
        analyse_effort: null,
        created_at: new Date(Date.now() - DAY).toISOString(),
        updated_at: new Date().toISOString(),
    }
}

export default function PreviewTimeline() {
    const [issues] = useState<Issue[]>(() => [
        mk("Design grid baseplate", "in_progress", "high", { startDay: 0, days: 3, lane: 0 }),
        mk("Snap-to-cell dragging", "open", "medium", { startDay: 2, days: 2, lane: 0.4 }),
        mk("Resize by tile length", "open", "urgent", { startDay: 1, days: 4, lane: 0.8 }),
        mk("Element palette bricks", "blocked", "high", { startDay: 5, days: 2, lane: 0.2 }),
        mk("Ship it", "done", "low", { startDay: 4, days: 1, lane: 1 }),
        mk("Write the outbox sync", "open", "medium"),
        mk("Tray click-to-place", "open", "low"),
        mk("Today column highlight", "in_progress", "medium"),
    ])

    const [openIssue, setOpenIssue] = useState<Issue | null>(null)

    return (
        <div className="fixed inset-0 flex flex-col bg-[color:var(--c-page)]">
            <TimelineGrid
                projectId="preview"
                issues={issues}
                labelIcons={[]}
                statusColors={[]}
                onTileClick={setOpenIssue}
            />

            {/* Issue description panel — opens when a tile is clicked. In
                the real app this is the IssueDrawer. */}
            {openIssue && (
                <>
                    <div className="fixed inset-0 z-40 bg-black/20" onClick={() => setOpenIssue(null)} />
                    <aside className="fixed right-0 top-0 z-50 flex h-full w-[380px] max-w-[86vw] flex-col gap-4 border-l border-[color:var(--c-border)] bg-[color:var(--c-surface)] p-5 shadow-[var(--shadow-pop)]">
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <div className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-[color:var(--c-text-muted)]">
                                    Issue #{openIssue.issue_number}
                                </div>
                                <h2 className="mt-0.5 text-[16px] font-bold tracking-[-0.01em]">{openIssue.title}</h2>
                            </div>
                            <button
                                type="button"
                                onClick={() => setOpenIssue(null)}
                                className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] border border-[color:var(--c-border)] text-[color:var(--c-text-muted)] hover:bg-[color:var(--c-overlay)]"
                                aria-label="Close"
                            >
                                ✕
                            </button>
                        </div>
                        <div className="flex flex-wrap gap-2 text-[11.5px] font-semibold">
                            <span className="rounded-full bg-[color:var(--c-surface-2)] px-2.5 py-1 capitalize">{openIssue.status.replace("_", " ")}</span>
                            <span className="rounded-full bg-[color:var(--c-surface-2)] px-2.5 py-1 capitalize">{openIssue.priority}</span>
                        </div>
                        <p className="text-[13px] leading-relaxed text-[color:var(--c-text-muted)]">
                            {openIssue.body || "No description yet. This is where the issue description would render."}
                        </p>
                    </aside>
                </>
            )}
        </div>
    )
}
