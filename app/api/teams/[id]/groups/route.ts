import { forbidden, jsonError, requireUser } from "@/lib/platform/http/api"
import { getTeamRole, roleAtLeast } from "@/lib/auth/team-access"
import { resolveUserProfiles } from "@/lib/auth/user-profiles"
import type { AccessGroup, AccessGroupWithDetail } from "@/lib/supabase/types"

// GET /api/teams/[id]/groups — the team's people-groups with their members
// (resolved profiles) and granted project ids. Any team member may view. This is
// tracker.access_groups (NOT project_groups / "Collections").
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { supabase, user, error } = await requireUser()
    if (error) return error
    const role = await getTeamRole(supabase, id, user.id)
    if (!role) return jsonError("not_found", "team not found", 404)

    const { data: groups, error: gErr } = await supabase
        .from("access_groups")
        .select("*")
        .eq("team_id", id)
        .order("name")
    if (gErr) return jsonError("db_error", gErr.message, 500)
    const groupList = (groups ?? []) as AccessGroup[]
    if (groupList.length === 0) return Response.json({ groups: [] })

    const groupIds = groupList.map((g) => g.id)
    const [{ data: memRows }, { data: projRows }] = await Promise.all([
        supabase.from("access_group_members").select("group_id, user_id").in("group_id", groupIds),
        supabase.from("access_group_projects").select("group_id, project_id").in("group_id", groupIds),
    ])
    const mem = (memRows ?? []) as { group_id: string; user_id: string }[]
    const proj = (projRows ?? []) as { group_id: string; project_id: string }[]

    const profiles = await resolveUserProfiles(mem.map((m) => m.user_id))
    const detailed: AccessGroupWithDetail[] = groupList.map((g) => ({
        ...g,
        members: mem
            .filter((m) => m.group_id === g.id)
            .map((m) => {
                const p = profiles.get(m.user_id)
                return { user_id: m.user_id, email: p?.email ?? null, name: p?.name ?? null, avatar_url: p?.avatar_url ?? null }
            }),
        project_ids: proj.filter((p) => p.group_id === g.id).map((p) => p.project_id),
    }))
    return Response.json({ groups: detailed })
}

// POST /api/teams/[id]/groups — create a people-group (admins).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { supabase, user, error } = await requireUser()
    if (error) return error
    const role = await getTeamRole(supabase, id, user.id)
    if (!role) return jsonError("not_found", "team not found", 404)
    if (!roleAtLeast(role, "admin")) return forbidden("only team admins can create groups")

    let body: Record<string, unknown>
    try { body = await request.json() } catch { return jsonError("bad_request", "invalid JSON", 400) }
    const name = String(body?.name ?? "").trim()
    if (!name) return jsonError("bad_request", "name is required", 400)
    const description = body?.description ? String(body.description) : null

    const { data, error: dbErr } = await supabase
        .from("access_groups")
        .insert({ team_id: id, name, description, created_by: user.id })
        .select("*")
        .single<AccessGroup>()
    if (dbErr) return jsonError("db_error", dbErr.message, 500)
    return Response.json({ group: { ...data, members: [], project_ids: [] } as AccessGroupWithDetail })
}
