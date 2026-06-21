import { jsonError, requireUser } from "@/lib/api"
import type { Issue, ProjectAnalyser, ProjectGroup } from "@/lib/supabase/types"

// GET — cross-project issue feed for a group's Issues tab. Returns the
// group's identity, its member projects (with analyser readiness +
// has-summary flags), and every issue across those projects in one
// round-trip. The client buckets/derives the parent-child trees per
// project, matching what the per-project Issues page does.
//
// Shape: { group: { id, name }, members: MemberInfo[], issues: Issue[] }
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { supabase, error } = await requireUser()
    if (error) return error

    const { data: group, error: gErr } = await supabase
        .from("project_groups")
        .select("id,name")
        .eq("id", id)
        .maybeSingle<Pick<ProjectGroup, "id" | "name">>()
    if (gErr) return jsonError("db_error", gErr.message, 500)
    if (!group) return jsonError("not_found", "group not found", 404)

    // Members + their analyser readiness + summary state in one
    // round-trip. Membership rows are RLS-gated through the group
    // so we trust the join shape here.
    const { data: links } = await supabase
        .from("project_group_members")
        .select("project_id,projects(id,name,project_analyser(status,enabled,graph_id,summary_overview_embedding))")
        .eq("group_id", id)
    type Link = { project_id: string; projects: unknown }
    interface MemberInfo {
        id: string
        name: string
        analyser_ready: boolean
        has_summary: boolean
    }
    const members: MemberInfo[] = []
    for (const r of (links as Link[] | null) ?? []) {
        const proj = Array.isArray(r.projects) ? r.projects[0] : r.projects
        if (!proj || typeof proj !== "object") continue
        const p = proj as { id: string; name: string; project_analyser?: unknown }
        const analyser = Array.isArray(p.project_analyser) ? p.project_analyser[0] : p.project_analyser
        const a = (analyser && typeof analyser === "object")
            ? analyser as Pick<ProjectAnalyser, "status" | "enabled" | "graph_id"> & {
                summary_overview_embedding?: unknown
            }
            : null
        members.push({
            id: p.id,
            name: p.name,
            analyser_ready: !!a && a.enabled === true && a.status === "ready" && !!a.graph_id,
            has_summary: !!a && a.summary_overview_embedding != null,
        })
    }
    members.sort((a, b) => a.name.localeCompare(b.name))

    const memberIds = members.map((m) => m.id)

    // Pull every issue across the member projects in one shot. Single
    // round-trip is cheaper than a query per project, and the limit
    // keeps the payload bounded for big groups.
    const { data: allIssues } = memberIds.length
        ? await supabase
            .from("issues")
            .select("*")
            .in("project_id", memberIds)
            .order("updated_at", { ascending: false })
            .limit(500)
            .returns<Issue[]>()
        : { data: [] as Issue[] }

    return Response.json({ group, members, issues: allIssues ?? [] })
}
