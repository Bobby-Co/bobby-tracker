"use client"

import { useParams } from "next/navigation"
import { useApi } from "@/lib/hooks/use-api"
import type { Project } from "@/lib/supabase/types"
import { ProjectTabs } from "@/components/project-tabs"
import { MiniIcon, toneFromString } from "@/components/field-card"

// Project detail shell. The header (name + repo link) loads the
// project via /api/projects/[id]; the tabs render immediately from the
// URL param and children render in parallel.
export default function ProjectLayout({ children }: { children: React.ReactNode }) {
    const { id } = useParams<{ id: string }>()
    return (
        <div className="flex min-h-full flex-col">
            <div className="border-b border-[color:var(--c-border)] bg-white">
                <div className="flex w-full max-w-5xl items-start justify-between gap-4 px-4 pt-5 sm:px-6 sm:pt-6">
                    <div className="min-w-0 max-w-full">
                        <ProjectHeader id={id} />
                    </div>
                </div>
                <div className="w-full max-w-5xl px-4 sm:px-6">
                    <ProjectTabs projectId={id} />
                </div>
            </div>
            <div className="w-full max-w-5xl flex-1 px-4 py-5 sm:px-6 sm:py-6">{children}</div>
        </div>
    )
}

function ProjectHeader({ id }: { id: string }) {
    const { data, loading } = useApi<{
        project: Pick<Project, "id" | "name" | "repo_url" | "repo_full_name"> | null
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
                <BoxIcon size={19} />
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
