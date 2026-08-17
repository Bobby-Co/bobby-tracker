import { ApiContext, jsonError, personalTeamName, repoRead } from "@/lib/server/http/api"
import { tryOrNull } from "@/lib/shared/kernel"
import type { TeamRole, TeamWithRole } from "@/lib/shared/types"

// GET /api/teams — the caller's teams (each with their role), personal team
// first. Bootstraps the personal team on first call. Backs the top-bar selector.
export async function GET() {
    const { ctx, user, error } = await new ApiContext().requireUser()
    if (error) return error
    try {
        const teams = await ctx.access.listTeams(user.id, personalTeamName(user))
        return Response.json({ teams })
    } catch (e) {
        return jsonError("team_error", e instanceof Error ? e.message : "failed to load teams", 500)
    }
}

// POST /api/teams — create a new (non-personal) team; the caller becomes its
// owner. Uses the create_team RPC so the team row + owner-membership are inserted
// atomically (RLS won't let you insert your own first membership otherwise).
export async function POST(request: Request) {
    const { ctx, error } = await new ApiContext().requireUser()
    if (error) return error

    let body: Record<string, unknown>
    try { body = await request.json() } catch { return jsonError("bad_request", "invalid JSON", 400) }
    const name = String(body?.name ?? "").trim()
    if (!name) return jsonError("bad_request", "name is required", 400)

    const { data: teamId, error: rpcErr } = await repoRead(() => ctx.teams.createTeam(name))
    if (rpcErr) return rpcErr

    // Return the freshly-created team in the same shape the selector consumes.
    // A read-back failure just yields null (best-effort), as before.
    const team = await tryOrNull(() => ctx.teams.findById(teamId))
    const withRole: TeamWithRole | null = team ? { ...team, role: "owner" as TeamRole } : null
    return Response.json({ team: withRole })
}
