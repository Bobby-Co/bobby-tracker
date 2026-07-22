import { ApiContext, forbidden, jsonError } from "@/lib/server/http/api"
import { getAccessService, Role } from "@/modules/access"
import type { AccessGroup } from "@/lib/shared/types"

// PATCH /api/teams/[id]/groups/[gid] — rename / re-describe a people-group (admins).
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; gid: string }> }) {
    const { id, gid } = await params
    const { supabase, user, error } = await new ApiContext().requireUser()
    if (error) return error
    const role = await getAccessService(supabase).teamRole(id, user.id)
    if (!role) return jsonError("not_found", "team not found", 404)
    if (!Role.of(role).atLeast("admin")) return forbidden("only team admins can edit groups")

    let body: Record<string, unknown>
    try { body = await request.json() } catch { return jsonError("bad_request", "invalid JSON", 400) }
    const patch: Record<string, unknown> = {}
    if (typeof body.name === "string") {
        const name = body.name.trim()
        if (!name) return jsonError("bad_request", "name can't be empty", 400)
        patch.name = name
    }
    if ("description" in body) patch.description = body.description ? String(body.description) : null
    if (Object.keys(patch).length === 0) return jsonError("bad_request", "no fields to update", 400)

    const { data, error: dbErr } = await supabase
        .from("access_groups")
        .update(patch)
        .eq("id", gid)
        .eq("team_id", id)
        .select("*")
        .single<AccessGroup>()
    if (dbErr) return jsonError("db_error", dbErr.message, 500)
    return Response.json({ group: data })
}

// DELETE /api/teams/[id]/groups/[gid] — delete a people-group (admins). Its
// membership + project grants cascade away.
export async function DELETE(_: Request, { params }: { params: Promise<{ id: string; gid: string }> }) {
    const { id, gid } = await params
    const { supabase, user, error } = await new ApiContext().requireUser()
    if (error) return error
    const role = await getAccessService(supabase).teamRole(id, user.id)
    if (!role) return jsonError("not_found", "team not found", 404)
    if (!Role.of(role).atLeast("admin")) return forbidden("only team admins can delete groups")

    const { error: dbErr } = await supabase.from("access_groups").delete().eq("id", gid).eq("team_id", id)
    if (dbErr) return jsonError("db_error", dbErr.message, 500)
    return new Response(null, { status: 204 })
}
