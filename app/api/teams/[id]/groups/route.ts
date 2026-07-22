import { ApiContext, forbidden, jsonError, repoRead } from "@/lib/server/http/api"
import { Role } from "@/modules/access"
import { createServiceAdminUserDirectory } from "@/modules/teams"
import type { AccessGroupWithDetail } from "@/lib/shared/types"

// GET /api/teams/[id]/groups — the team's people-groups with their members
// (resolved profiles) and granted project ids. Any team member may view. This is
// tracker.access_groups (NOT project_groups / "Collections").
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { ctx, user, error } = await new ApiContext().requireUser()
    if (error) return error
    const role = await ctx.access.teamRole(id, user.id)
    if (!role) return jsonError("not_found", "team not found", 404)

    const { data: groupList, error: gErr } = await repoRead(() => ctx.accessGroups.listForTeam(id))
    if (gErr) return gErr
    if (groupList.length === 0) return Response.json({ groups: [] })

    const groupIds = groupList.map((g) => g.id)
    const [mem, proj] = await Promise.all([
        ctx.accessGroups.listMembers(groupIds),
        ctx.accessGroups.listProjectGrants(groupIds),
    ])

    const profiles = await createServiceAdminUserDirectory().resolveProfiles(mem.map((m) => m.user_id))
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
    const { ctx, user, error } = await new ApiContext().requireUser()
    if (error) return error
    const role = await ctx.access.teamRole(id, user.id)
    if (!role) return jsonError("not_found", "team not found", 404)
    if (!Role.of(role).atLeast("admin")) return forbidden("only team admins can create groups")

    let body: Record<string, unknown>
    try { body = await request.json() } catch { return jsonError("bad_request", "invalid JSON", 400) }
    const name = String(body?.name ?? "").trim()
    if (!name) return jsonError("bad_request", "name is required", 400)
    const description = body?.description ? String(body.description) : null

    const { data, error: dbErr } = await repoRead(() => ctx.accessGroups.create(id, name, description, user.id))
    if (dbErr) return dbErr
    return Response.json({ group: { ...data, members: [], project_ids: [] } as AccessGroupWithDetail })
}
