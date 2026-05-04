import Link from "next/link"
import { notFound } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import type { ProjectGroup } from "@/lib/supabase/types"
import { GroupManagePanel } from "@/components/group-manage-panel"

export const dynamic = "force-dynamic"

// Per-group management page. Owners edit the name/description, manage
// project membership, and launch the group-aware AI compose flow
// from here.
export default async function GroupDetailPage({
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

    // Members + has-summary flag — drives the routing UI's "needs
    // index" hint per row.
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

    // Eligible projects for the picker = all owner's projects.
    const { data: projects } = await supabase
        .from("projects")
        .select("id,name")
        .order("name", { ascending: true })
    const allProjects = (projects ?? []).map((p) => ({ id: p.id, name: p.name }))

    return (
        <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 sm:py-10">
            <Link
                href="/groups"
                className="text-[11px] font-bold uppercase tracking-[0.12em] text-[color:var(--c-text-muted)] hover:text-[color:var(--c-text)]"
            >
                ← Groups
            </Link>
            <h1 className="mt-2 truncate text-[22px] font-bold tracking-[-0.012em]">{group.name}</h1>
            <GroupManagePanel
                group={group}
                members={members}
                allProjects={allProjects}
            />
        </div>
    )
}
