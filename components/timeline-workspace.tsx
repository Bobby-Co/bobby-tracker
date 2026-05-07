"use client"

import Link from "next/link"
import { useState } from "react"
import { IssueDrawer } from "@/components/issue-drawer"
import { IssueTimeline } from "@/components/issue-timeline"
import { LabelIconManager } from "@/components/label-icon-manager"
import type {
    Issue,
    Project,
    ProjectLabelIcon,
    ProjectStatusColor,
} from "@/lib/supabase/types"

// TimelineWorkspace — the full-screen page chrome around the
// planning timeline. Renders as a fixed overlay so the parent
// project layout's tabs / page header don't show through.
//
// State lives here: the active drawer-open issue, and whether the
// label-icon manager is open. Both pieces are sibling concerns to
// the canvas itself.
export function TimelineWorkspace({
    project,
    issues,
    labelIcons,
    statusColors,
    usedLabels,
    focusIssueId,
}: {
    project: Pick<Project, "id" | "name" | "repo_url" | "repo_full_name">
    issues: Issue[]
    labelIcons: ProjectLabelIcon[]
    statusColors: ProjectStatusColor[]
    usedLabels: string[]
    focusIssueId?: string | null
}) {
    const [openIssue, setOpenIssue] = useState<Issue | null>(null)
    const [iconsOpen, setIconsOpen] = useState(false)

    const have = new Set(labelIcons.map((i) => i.label))
    const missing = usedLabels.filter((l) => !have.has(l))

    return (
        <div className="fixed inset-0 z-30 flex flex-col bg-[color:var(--c-page)]">
            {/* Header */}
            <header className="flex items-center justify-between gap-3 border-b border-[color:var(--c-border)] bg-white px-5 py-3">
                <div className="flex min-w-0 items-center gap-3">
                    <Link
                        href={`/projects/${project.id}/issues`}
                        className="grid h-8 w-8 place-items-center rounded-[10px] border border-[color:var(--c-border)] bg-white text-[color:var(--c-text-muted)] hover:bg-[color:var(--c-overlay)] hover:text-[color:var(--c-text)]"
                        aria-label="Back to issues"
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M15 6l-6 6 6 6" />
                        </svg>
                    </Link>
                    <div className="min-w-0">
                        <div className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-[color:var(--c-text-muted)]">
                            Timeline
                        </div>
                        <h1 className="truncate text-[15px] font-bold tracking-[-0.005em]">{project.name}</h1>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {missing.length > 0 && (
                        <span className="hidden items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-[11.5px] font-semibold text-amber-800 sm:inline-flex">
                            <DotIcon /> {missing.length} label{missing.length === 1 ? "" : "s"} need icons
                        </span>
                    )}
                    <button
                        type="button"
                        onClick={() => setIconsOpen(true)}
                        className="rounded-[10px] border border-[color:var(--c-border)] bg-white px-3 py-1.5 text-[12px] font-semibold hover:bg-[color:var(--c-overlay)]"
                    >
                        Manage label icons
                    </button>
                </div>
            </header>

            {/* Canvas area */}
            <main className="flex min-h-0 flex-1 flex-col px-5 py-4">
                <IssueTimeline
                    projectId={project.id}
                    issues={issues}
                    labelIcons={labelIcons}
                    statusColors={statusColors}
                    onTileClick={setOpenIssue}
                    fullHeight
                    focusIssueId={focusIssueId ?? null}
                />
            </main>

            <LabelIconManager
                open={iconsOpen}
                onClose={() => setIconsOpen(false)}
                projectId={project.id}
                usedLabels={usedLabels}
                initialIcons={labelIcons}
            />

            <IssueDrawer
                issue={openIssue}
                projectId={project.id}
                labelIcons={labelIcons}
                statusColors={statusColors}
                onClose={() => setOpenIssue(null)}
            />
        </div>
    )
}

function DotIcon() {
    return (
        <svg width="6" height="6" viewBox="0 0 6 6" fill="currentColor" aria-hidden>
            <circle cx="3" cy="3" r="3" />
        </svg>
    )
}
