import { notFound } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { TimelineWorkspace } from "@/components/timeline-workspace"
import type {
    Issue,
    Project,
    ProjectLabelIcon,
    ProjectStatusColor,
} from "@/lib/supabase/types"

export const dynamic = "force-dynamic"

// Full-page planning timeline. Lives at its own route so the user
// gets the whole viewport — the parent project layout's header /
// tabs are covered by the workspace's fixed overlay.
export default async function TimelinePage({
    params,
    searchParams,
}: {
    params: Promise<{ id: string }>
    searchParams: Promise<{ focus?: string }>
}) {
    const { id } = await params
    const { focus } = await searchParams
    const supabase = await createClient()

    const [{ data: project }, { data: issues }, { data: labelIcons }, { data: statusColors }] = await Promise.all([
        supabase
            .from("projects")
            .select("id,name,repo_url,repo_full_name")
            .eq("id", id)
            .maybeSingle<Pick<Project, "id" | "name" | "repo_url" | "repo_full_name">>(),
        supabase
            .from("issues")
            .select("*")
            .eq("project_id", id)
            .order("updated_at", { ascending: false })
            .returns<Issue[]>(),
        supabase
            .from("project_label_icons")
            .select("*")
            .eq("project_id", id)
            .returns<ProjectLabelIcon[]>(),
        supabase
            .from("project_status_colors")
            .select("*")
            .eq("project_id", id)
            .returns<ProjectStatusColor[]>(),
    ])

    if (!project) notFound()

    const list = (issues ?? []).filter((i) => !i.duplicate_of_issue_id)
    const usedLabels = collectLabels(list)

    return (
        <TimelineWorkspace
            project={project}
            issues={list}
            labelIcons={labelIcons ?? []}
            statusColors={statusColors ?? []}
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
