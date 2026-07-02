"use client"

import { useMemo } from "react"
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

    const { data, error, loading, refetch } = useApi<TimelineData>(
        id ? `/api/projects/${id}/timeline` : null,
    )

    // Memoise so the issues array keeps a stable reference across
    // re-renders that don't change the fetched data (e.g. opening the
    // drawer, or a background refetch flipping `loading`). The timeline
    // resets its local/optimistic state whenever this prop's reference
    // changes, so a fresh array every render would clobber pending edits.
    const list = useMemo(
        () => (data?.issues ?? []).filter((i) => !i.duplicate_of_issue_id),
        [data],
    )
    const usedLabels = useMemo(() => collectLabels(list), [list])

    // Only block on the initial load. Once we have data, a refetch
    // (e.g. after a schedule save) revalidates in the background without
    // flashing the skeleton and unmounting the canvas.
    if (loading && !data) {
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

    return (
        <TimelineWorkspace
            project={project}
            issues={list}
            labelIcons={data?.labelIcons ?? []}
            statusColors={data?.statusColors ?? []}
            usedLabels={usedLabels}
            focusIssueId={focus ?? null}
            onPersisted={refetch}
        />
    )
}

function collectLabels(issues: Issue[]): string[] {
    const seen = new Set<string>()
    for (const i of issues) for (const l of i.labels) seen.add(l)
    return Array.from(seen).sort()
}
