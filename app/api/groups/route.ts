import { ApiContext, jsonError } from "@/lib/server/http/api"
import type { ProjectGroup } from "@/lib/shared/types"

// "Collections" (project_groups): a group of PROJECTS for AI routing. Now scoped
// to the active team (migration 0052) — distinct from a team's people Groups.
// GET   — list the active team's collections (newest first)
// POST  — create a collection, optionally with an initial project list

export async function GET(request: Request) {
    const { supabase, teamId, error } = await new ApiContext(request).requireTeam()
    if (error) return error
    const { data, error: dbErr } = await supabase
        .from("project_groups")
        .select("*")
        .eq("team_id", teamId)
        .order("updated_at", { ascending: false })
        .returns<ProjectGroup[]>()
    if (dbErr) return jsonError("db_error", dbErr.message, 500)

    // Attach member counts + project names per group in one extra
    // round-trip so the UI can render "N projects" and name pills
    // without N+1 queries. Shape:
    //   { groups: (ProjectGroup & { member_count: number; member_names: string[] })[] }
    const list = data ?? []
    const ids = list.map((g) => g.id)
    const { data: links } = ids.length
        ? await supabase
            .from("project_group_members")
            .select("group_id,project_id,projects(name)")
            .in("group_id", ids)
        : { data: [] as { group_id: string; project_id: string; projects: { name: string } | { name: string }[] | null }[] }

    const namesByGroup = new Map<string, string[]>()
    for (const l of links ?? []) {
        const proj = Array.isArray(l.projects) ? l.projects[0] : l.projects
        const name = proj && typeof proj === "object" && "name" in proj ? proj.name : ""
        if (!name) continue
        const names = namesByGroup.get(l.group_id) ?? []
        names.push(name)
        namesByGroup.set(l.group_id, names)
    }

    const groups = list.map((g) => {
        const member_names = namesByGroup.get(g.id) ?? []
        return { ...g, member_names, member_count: member_names.length }
    })
    return Response.json({ groups })
}

export async function POST(request: Request) {
    const { supabase, user, teamId, error } = await new ApiContext(request).requireTeam()
    if (error) return error

    let body: Record<string, unknown> = {}
    try { body = await request.json() } catch { /* allow empty */ }

    const name = typeof body.name === "string" ? body.name.trim() : ""
    if (!name) return jsonError("bad_request", "name required", 400)

    const description = typeof body.description === "string" ? body.description.trim() || null : null
    const projectIdsIn = Array.isArray(body.project_ids)
        ? body.project_ids.filter((x: unknown): x is string => typeof x === "string")
        : []

    const { data: group, error: insErr } = await supabase
        .from("project_groups")
        .insert({ team_id: teamId, user_id: user.id, name, description })
        .select("*")
        .single<ProjectGroup>()
    if (insErr) return jsonError("db_error", insErr.message, 500)

    // Best-effort initial-membership insert. The RLS with-check on the
    // junction enforces that each project_id belongs to the same user,
    // so a stray id from the client is rejected at the row level.
    if (projectIdsIn.length > 0) {
        const { error: linkErr } = await supabase
            .from("project_group_members")
            .insert(projectIdsIn.map((project_id) => ({ group_id: group.id, project_id })))
        if (linkErr) return jsonError("db_error", linkErr.message, 500)
    }

    return Response.json({ group })
}
