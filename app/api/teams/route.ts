import { ApiContext, jsonError, personalTeamName, repoRead } from "@/lib/server/http/api"
import { tryOrNull } from "@/lib/shared/kernel"
import type { TeamRole, TeamWithRole } from "@/lib/shared/types"
import { deriveRegionLabel, getRegionRegistry, parseRegionId, type CellId, type RegionId } from "@/modules/regions"

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
    const { ctx, user, error } = await new ApiContext().requireUser()
    if (error) return error

    let body: Record<string, unknown>
    try { body = await request.json() } catch { return jsonError("bad_request", "invalid JSON", 400) }
    const name = String(body?.name ?? "").trim()
    if (!name) return jsonError("bad_request", "name is required", 400)

    // Placement (0064/0065). The caller picks a REGION — coarse geography, the
    // only part they ever see — and the registry assigns a CELL inside it. Fixed
    // for the life of the team: every project it owns is served from here, so
    // moving it means re-indexing all of them.
    const registry = getRegionRegistry()
    const requested = typeof body?.region === "string" ? parseRegionId(body.region) : null
    if (typeof body?.region === "string" && !requested) {
        return jsonError("bad_request", "region is not a valid identifier", 400)
    }

    const homeCell = registry.homeCell()
    let region: RegionId
    let cell: CellId
    if (requested) {
        // A chosen region must have a cell with an analyser behind it, or the team
        // would be created somewhere none of its projects could ever be indexed —
        // a dead end the user has no way to diagnose.
        const assigned = registry.assignCell(requested)
        if (!assigned) {
            return jsonError(
                "region_unavailable",
                `${deriveRegionLabel(requested)} is not available. Pick another region.`,
                503,
            )
        }
        region = requested
        cell = assigned
    } else {
        // No choice offered (a single-region deployment) → home. Deliberately not
        // gated on the cell being configured: creating teams before an analyser is
        // reachable already works, and tightening it here would break local dev.
        cell = homeCell
        region = registry.cell(homeCell).region
    }

    const { data: teamId, error: rpcErr } = await repoRead(() => ctx.teams.createTeam(name, region, cell, user.id))
    if (rpcErr) return rpcErr

    // Return the freshly-created team in the same shape the selector consumes.
    // A read-back failure just yields null (best-effort), as before.
    const team = await tryOrNull(() => ctx.teams.findById(teamId))
    const withRole: TeamWithRole | null = team ? { ...team, role: "owner" as TeamRole } : null
    return Response.json({ team: withRole })
}
