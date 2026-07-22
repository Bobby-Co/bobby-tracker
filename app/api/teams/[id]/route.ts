import { ApiContext, forbidden, jsonError } from "@/lib/server/http/api"
import { getAccessService, Role } from "@/modules/access"
import type { Team, TeamWithRole } from "@/lib/shared/types"

// GET /api/teams/[id] — a team the caller belongs to, with their role.
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { supabase, user, error } = await new ApiContext().requireUser()
    if (error) return error
    const role = await getAccessService(supabase).teamRole(id, user.id)
    if (!role) return jsonError("not_found", "team not found", 404)
    const { data, error: dbErr } = await supabase.from("teams").select("*").eq("id", id).maybeSingle<Team>()
    if (dbErr) return jsonError("db_error", dbErr.message, 500)
    const team: TeamWithRole | null = data ? { ...data, role } : null
    return Response.json({ team })
}

// PATCH /api/teams/[id] — rename the team (admins). Personal teams can't be renamed.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { supabase, user, error } = await new ApiContext().requireUser()
    if (error) return error
    const role = await getAccessService(supabase).teamRole(id, user.id)
    if (!role) return jsonError("not_found", "team not found", 404)
    if (!Role.of(role).atLeast("admin")) return forbidden("only team admins can rename a team")

    let body: Record<string, unknown>
    try { body = await request.json() } catch { return jsonError("bad_request", "invalid JSON", 400) }
    const name = String(body?.name ?? "").trim()
    if (!name) return jsonError("bad_request", "name is required", 400)

    const { data: existing } = await supabase.from("teams").select("is_personal").eq("id", id).maybeSingle<{ is_personal: boolean }>()
    if (existing?.is_personal) return jsonError("bad_request", "a personal team can't be renamed", 400)

    const { data, error: dbErr } = await supabase.from("teams").update({ name }).eq("id", id).select("*").single<Team>()
    if (dbErr) return jsonError("db_error", dbErr.message, 500)
    return Response.json({ team: { ...data, role } as TeamWithRole })
}

// DELETE /api/teams/[id] — owners only; personal teams are protected by RLS
// (teams_owner_delete uses `not is_personal`). Cascades resources — a heavy op
// the UI should confirm.
export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { supabase, user, error } = await new ApiContext().requireUser()
    if (error) return error
    const role = await getAccessService(supabase).teamRole(id, user.id)
    if (!role) return jsonError("not_found", "team not found", 404)
    if (role !== "owner") return forbidden("only the team owner can delete a team")

    const { error: dbErr } = await supabase.from("teams").delete().eq("id", id)
    if (dbErr) return jsonError("db_error", dbErr.message, 500)
    return new Response(null, { status: 204 })
}
