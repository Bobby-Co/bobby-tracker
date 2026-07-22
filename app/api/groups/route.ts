import { ApiContext, jsonError, repoRead } from "@/lib/server/http/api"

// "Collections" (project_groups): a group of PROJECTS for AI routing. Now scoped
// to the active team (migration 0052) — distinct from a team's people Groups.
// GET   — list the active team's collections (newest first)
// POST  — create a collection, optionally with an initial project list

export async function GET(request: Request) {
    const { ctx, teamId, error } = await new ApiContext(request).requireTeam()
    if (error) return error
    const { data: list, error: dbErr } = await repoRead(() => ctx.collections.listForTeam(teamId))
    if (dbErr) return dbErr

    // Attach member counts + project names per group in one extra
    // round-trip so the UI can render "N projects" and name pills
    // without N+1 queries. Shape:
    //   { groups: (ProjectGroup & { member_count: number; member_names: string[] })[] }
    const ids = list.map((g) => g.id)
    const links = await ctx.collections.listMemberNames(ids)

    const namesByGroup = new Map<string, string[]>()
    for (const l of links) {
        const names = namesByGroup.get(l.group_id) ?? []
        names.push(l.name)
        namesByGroup.set(l.group_id, names)
    }

    const groups = list.map((g) => {
        const member_names = namesByGroup.get(g.id) ?? []
        return { ...g, member_names, member_count: member_names.length }
    })
    return Response.json({ groups })
}

export async function POST(request: Request) {
    const { ctx, user, teamId, error } = await new ApiContext(request).requireTeam()
    if (error) return error

    let body: Record<string, unknown> = {}
    try { body = await request.json() } catch { /* allow empty */ }

    const name = typeof body.name === "string" ? body.name.trim() : ""
    if (!name) return jsonError("bad_request", "name required", 400)

    const description = typeof body.description === "string" ? body.description.trim() || null : null
    const projectIdsIn = Array.isArray(body.project_ids)
        ? body.project_ids.filter((x: unknown): x is string => typeof x === "string")
        : []

    const { data: group, error: insErr } = await repoRead(() => ctx.collections.create(teamId, user.id, name, description))
    if (insErr) return insErr

    // Best-effort initial-membership insert. The RLS with-check on the
    // junction enforces that each project_id belongs to the same user,
    // so a stray id from the client is rejected at the row level.
    if (projectIdsIn.length > 0) {
        const { error: linkErr } = await repoRead(() => ctx.collections.addMembers(group.id, projectIdsIn))
        if (linkErr) return linkErr
    }

    return Response.json({ group })
}
