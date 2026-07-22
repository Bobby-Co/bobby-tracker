import { jsonError, personalTeamName, requireUser } from "@/lib/server/http/api"
import { getUserTeams } from "@/lib/server/auth/team-access"
import type { Team, TeamRole, TeamWithRole } from "@/lib/shared/types"

// GET /api/teams — the caller's teams (each with their role), personal team
// first. Bootstraps the personal team on first call. Backs the top-bar selector.
export async function GET() {
    const { supabase, user, error } = await requireUser()
    if (error) return error
    try {
        const teams = await getUserTeams(supabase, user.id, personalTeamName(user))
        return Response.json({ teams })
    } catch (e) {
        return jsonError("team_error", e instanceof Error ? e.message : "failed to load teams", 500)
    }
}

// POST /api/teams — create a new (non-personal) team; the caller becomes its
// owner. Uses the create_team RPC so the team row + owner-membership are inserted
// atomically (RLS won't let you insert your own first membership otherwise).
export async function POST(request: Request) {
    const { supabase, error } = await requireUser()
    if (error) return error

    let body: Record<string, unknown>
    try { body = await request.json() } catch { return jsonError("bad_request", "invalid JSON", 400) }
    const name = String(body?.name ?? "").trim()
    if (!name) return jsonError("bad_request", "name is required", 400)

    const { data: teamId, error: rpcErr } = await supabase.rpc("create_team", { p_name: name })
    if (rpcErr) return jsonError("db_error", rpcErr.message, 500)

    // Return the freshly-created team in the same shape the selector consumes.
    const { data: team } = await supabase.from("teams").select("*").eq("id", teamId).maybeSingle<Team>()
    const withRole: TeamWithRole | null = team ? { ...team, role: "owner" as TeamRole } : null
    return Response.json({ team: withRole })
}
