import { jsonError, requireUser } from "@/lib/api"
import type { ProjectGroup } from "@/lib/supabase/types"

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { supabase, error } = await requireUser()
    if (error) return error
    const { data, error: dbErr } = await supabase
        .from("project_groups")
        .select("*")
        .eq("id", id)
        .maybeSingle<ProjectGroup>()
    if (dbErr) return jsonError("db_error", dbErr.message, 500)
    if (!data) return jsonError("not_found", "group not found", 404)

    // Hydrate members with project name + whether the project has a
    // summary embedding yet (drives the routing UI's "needs index"
    // hint per row).
    const { data: links } = await supabase
        .from("project_group_members")
        .select("project_id,projects(id,name,project_analyser(summary_overview_embedding,summary_modules_embedding))")
        .eq("group_id", id)
    type Link = {
        project_id: string
        projects: unknown
    }
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

    return Response.json({ group: data, members })
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { supabase, error } = await requireUser()
    if (error) return error

    let body: Record<string, unknown>
    try { body = await request.json() } catch { return jsonError("bad_request", "invalid JSON", 400) }

    const patch: Record<string, unknown> = {}
    if (typeof body.name === "string") {
        const v = body.name.trim()
        if (!v) return jsonError("bad_request", "name cannot be empty", 400)
        patch.name = v
    }
    if (typeof body.description === "string") patch.description = body.description.trim() || null
    if (Object.keys(patch).length === 0) return jsonError("bad_request", "no fields to update", 400)

    const { data, error: dbErr } = await supabase
        .from("project_groups")
        .update(patch)
        .eq("id", id)
        .select("*")
        .single<ProjectGroup>()
    if (dbErr) return jsonError("db_error", dbErr.message, 500)
    return Response.json({ group: data })
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { supabase, error } = await requireUser()
    if (error) return error
    const { error: dbErr } = await supabase.from("project_groups").delete().eq("id", id)
    if (dbErr) return jsonError("db_error", dbErr.message, 500)
    return new Response(null, { status: 204 })
}
