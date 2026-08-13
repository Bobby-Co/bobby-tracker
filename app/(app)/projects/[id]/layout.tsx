"use client"

import { useEffect } from "react"
import { useParams, usePathname, useRouter } from "next/navigation"
import { useApi } from "@/lib/client/hooks/use-api"
import type { Project, ProjectAnalyser } from "@/lib/shared/types"
import { ProjectAnalyser as ProjectAnalyserModel } from "@/modules/analysis/domain/ProjectAnalyser"
import { ProjectTabs } from "@/components/projects/project-tabs"
import { ProjectActivityChips } from "@/components/projects/project-activity-chips"
import { MiniIcon, toneFromString } from "@/components/ui/field-card"
import { IconlyIcon } from "@/components/icons/iconly-icon"
import { cn } from "@/components/ui/cn"
import { isImmersiveMind, isProjectWizard } from "@/components/layout/immersive"

// Project detail shell. The header (name + repo link) loads the
// project via /api/projects/[id]; the tabs render immediately from the
// URL param and children render in parallel.
//
// On the Mind tab the shell goes "immersive": the header + tabs collapse away
// and the content fills the full height/width so the chat can take over the
// window (see components/immersive.ts). The first-run setup wizard is
// "chromeless" the same way. Layouts persist across tab changes, so toggling
// this animates via the CSS transitions below.
export default function ProjectLayout({ children }: { children: React.ReactNode }) {
    const { id } = useParams<{ id: string }>()
    const pathname = usePathname()
    const immersiveMind = isImmersiveMind(pathname)
    const onWizard = isProjectWizard(pathname)
    // Settings (delete) stays reachable even for an un-indexed project — else a
    // user who never wants to index couldn't delete it (they'd be trapped in the
    // wizard). Exempt it (and the wizard itself) from the setup gate.
    const onSettings = /^\/projects\/[^/]+\/settings\/?$/.test(pathname ?? "")
    // Header + tabs collapse for both the Mind chat and the setup wizard; only
    // Mind claims the full viewport (the wizard keeps the normal content column).
    const chromeless = immersiveMind || onWizard

    // Setup gate: a project isn't usable until its graph starts building. Until
    // a first index has kicked off, the working tabs bounce to the wizard.
    useSetupGate(id, onWizard || onSettings)

    return (
        <div className={cn("flex flex-col", immersiveMind ? "h-full min-h-0" : "min-h-full")}>
            <div
                className={cn(
                    "overflow-hidden border-[color:var(--c-border)] bg-[color:var(--c-surface)] transition-all duration-500",
                    chromeless ? "max-h-0 border-b-0 opacity-0" : "max-h-[400px] border-b opacity-100",
                )}
            >
                <div className="flex w-full max-w-5xl items-start justify-between gap-4 px-4 pt-5 sm:px-6 sm:pt-6">
                    <div className="min-w-0 max-w-full">
                        <ProjectHeader id={id} />
                    </div>
                    {/* Right slot of the header row — background-work status. Lives here
                        rather than in a tab because the work it reports (indexing,
                        embedding) belongs to the project, not to whichever tab you
                        happen to be on. Renders nothing when the project is idle.
                        Skipped while chromeless: the header is collapsed to max-h-0
                        there, so mounting it would only start a needless poll. */}
                    {!chromeless && <ProjectActivityChips projectId={id} />}
                </div>
                <div className="w-full max-w-5xl px-4 sm:px-6">
                    <ProjectTabs projectId={id} />
                </div>
            </div>
            <div className={cn("flex-1", immersiveMind ? "min-h-0 w-full" : "w-full max-w-5xl px-4 py-5 sm:px-6 sm:py-6")}>{children}</div>
        </div>
    )
}

// useSetupGate redirects unconfigured projects to the first-run wizard. A
// project is "configured enough" once a first index has started — status is
// indexing/ready/failed (a bootstrap was kicked off at least once). Before that
// (no analyser row, or disabled/pending) the project's pages aren't useful, so
// we replace() to the wizard. `exempt` covers the wizard + settings routes.
// Never fires during load or when we can't tell (fail open — better than
// trapping the user).
function useSetupGate(id: string, exempt: boolean) {
    const router = useRouter()
    const { data, loading } = useApi<{ analyser: Pick<ProjectAnalyser, "status" | "graph_id"> | null }>(
        id && !exempt ? `/api/projects/${id}/knowledge` : null,
    )
    useEffect(() => {
        if (exempt || loading || !data) return
        const status = data.analyser?.status
        const started = ProjectAnalyserModel.of({ status }).hasStarted()
        if (!started) router.replace(`/projects/${id}/setup`)
    }, [exempt, loading, data, id, router])
}

function ProjectHeader({ id }: { id: string }) {
    const { data, loading } = useApi<{
        project: Pick<Project, "id" | "name" | "repo_url" | "repo_full_name" | "icon_name"> | null
    }>(`/api/projects/${id}`)

    if (loading) return <HeaderSkeleton />
    const project = data?.project
    if (!project) {
        return (
            <h1 className="mt-1 truncate text-[20px] font-bold tracking-[-0.012em] sm:text-[22px]">
                Project not found
            </h1>
        )
    }
    return (
        <div className="mt-1.5 flex items-center gap-3">
            <MiniIcon tone={toneFromString(project.name)} size={40}>
                {project.icon_name ? <IconlyIcon name={project.icon_name} size={20} /> : <BoxIcon size={19} />}
            </MiniIcon>
            <div className="min-w-0">
                <h1 className="truncate text-[20px] font-bold tracking-[-0.012em] sm:text-[22px]">
                    {project.name}
                </h1>
                <a
                    href={project.repo_url}
                    target="_blank"
                    rel="noreferrer"
                    className="block max-w-full truncate font-mono text-[12px] text-[color:var(--c-text-muted)] hover:text-[color:var(--c-text)] hover:underline"
                >
                    {project.repo_full_name ? project.repo_full_name : project.repo_url}
                </a>
            </div>
        </div>
    )
}

function BoxIcon({ size = 13 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect x="3" y="3" width="18" height="18" rx="3" />
            <path d="M3 9h18M9 21V9" />
        </svg>
    )
}

function HeaderSkeleton() {
    return (
        <div className="mt-1.5 flex items-center gap-3">
            <div className="skeleton h-10 w-10 rounded-full" />
            <div className="min-w-0">
                <div className="skeleton h-6 w-48 rounded-[6px] sm:h-7" />
                <div className="skeleton mt-1.5 h-3 w-64 max-w-full rounded-[4px]" />
            </div>
        </div>
    )
}
