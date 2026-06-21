"use client"

import { notFound, useParams, useSearchParams } from "next/navigation"
import { useApi } from "@/lib/hooks/use-api"
import { TimelineWorkspace } from "@/components/timeline-workspace"
import type {
    Issue,
    Project,
    ProjectLabelIcon,
    ProjectStatusColor,
} from "@/lib/supabase/types"

// Full-page planning timeline. Lives at its own route so the user
// gets the whole viewport — the parent project layout's header /
// tabs are covered by the workspace's fixed overlay.

type TimelineData = {
    project: Pick<Project, "id" | "name" | "repo_url" | "repo_full_name"> | null
    issues: Issue[]
    labelIcons: ProjectLabelIcon[]
    statusColors: ProjectStatusColor[]
}

export default function TimelinePage() {
    const { id } = useParams<{ id: string }>()
    const searchParams = useSearchParams()
    const focus = searchParams.get("focus") ?? undefined

    const { data, error, loading } = useApi<TimelineData>(
        id ? `/api/projects/${id}/timeline` : null,
    )

    if (loading) {
        return (
            <div className="fixed inset-0 z-30 flex flex-col bg-[color:var(--c-page)]">
                <div className="skeleton h-14 w-full" />
                <div className="skeleton m-4 grow rounded-[16px]" />
            </div>
        )
    }

    if (error) {
        return (
            <div className="fixed inset-0 z-30 grid place-items-center bg-[color:var(--c-page)] p-6">
                <div className="rounded-[12px] border border-rose-200 bg-rose-50 px-4 py-3 text-[12.5px] text-rose-800">
                    {error}
                </div>
            </div>
        )
    }

    const project = data?.project ?? null
    if (!project) notFound()

    const list = (data?.issues ?? []).filter((i) => !i.duplicate_of_issue_id)
    const usedLabels = collectLabels(list)

    return (
        <TimelineWorkspace
            project={project}
            issues={list}
            labelIcons={data?.labelIcons ?? []}
            statusColors={data?.statusColors ?? []}
            usedLabels={usedLabels}
            focusIssueId={focus ?? null}
        />
    )
}

function collectLabels(issues: Issue[]): string[] {
    const seen = new Set<string>()
    for (const i of issues) for (const l of i.labels) seen.add(l)
    return Array.from(seen).sort()
}
