import { Suspense } from "react"
import { notFound } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import type { ProjectGroup } from "@/lib/supabase/types"
import { GroupManagePanel } from "@/components/group-manage-panel"
import { GroupSettingsSkeleton } from "@/components/group-settings-skeleton"

export const dynamic = "force-dynamic"

// Settings tab: name / description / member CRUD / delete. The
// header is owned by the group layout, so this page only renders
// the management panel itself.
//
// Sync shell wraps a streaming <Suspense> boundary so soft tab
// switches paint the skeleton immediately instead of waiting on
// the membership round-trip.
export default function GroupSettingsPage({
    params,
}: {
    params: Promise<{ id: string }>
}) {
    return (
        <Suspense fallback={<GroupSettingsSkeleton />}>
            <GroupSettingsContent params={params} />
        </Suspense>
    )
}

async function GroupSettingsContent({
    params,
}: {
    params: Promise<{ id: string }>
}) {
    const { id } = await params
    const supabase = await createClient()

    const { data: group } = await supabase
        .from("project_groups")
        .select("*")
        .eq("id", id)
        .maybeSingle<ProjectGroup>()
    if (!group) notFound()

    // Members with has-summary flag for the routing-readiness hint.
    const { data: links } = await supabase
        .from("project_group_members")
        .select("project_id,projects(id,name,project_analyser(summary_overview_embedding,summary_modules_embedding))")
        .eq("group_id", id)
    type Link = { project_id: string; projects: unknown }
    const members: { id: string; name: string; has_summary: boolean }[] = []
    for (const r of (links as Link[] | null) ?? []) {
        const proj = Array.isArray(r.projects) ? r.projects[0] : r.projects
        if (!proj || typeof proj !== "object") continue
        const p = proj as { id: string; name: string; project_analyser?: unknown }
        const analyser = Array.isArray(p.project_analyser) ? p.project_analyser[0] : p.project_analyser
        const a = (analyser && typeof analyser === "object")
            ? analyser as { summary_overview_embedding?: unknown; summary_modules_embedding?: unknown }
            : null
        const hasSummary = !!a && (a.summary_overview_embedding != null || a.summary_modules_embedding != null)
        members.push({ id: p.id, name: p.name, has_summary: hasSummary })
    }
    members.sort((a, b) => a.name.localeCompare(b.name))

    const { data: projects } = await supabase
        .from("projects")
        .select("id,name")
        .order("name", { ascending: true })
    const allProjects = (projects ?? []).map((p) => ({ id: p.id, name: p.name }))

    return (
        <GroupManagePanel
            group={group}
            members={members}
            allProjects={allProjects}
        />
    )
}
