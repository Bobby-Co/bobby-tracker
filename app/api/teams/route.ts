import { ApiContext, jsonError, personalTeamName, repoRead } from "@/lib/server/http/api"
import { tryOrNull } from "@/lib/shared/kernel"
import type { TeamRole, TeamWithRole } from "@/lib/shared/types"
import { deriveRegionLabel, getRegionRegistry, parseRegionId, type CellId, type RegionId } from "@/modules/regions"
import { SlotPolicy, hashAccountEmail, type Allocation } from "@/modules/billing"
import type { RequestContext } from "@/lib/server/http/api"

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

    // ─── the free-team quota (0076) ──────────────────────────────────────────
    //
    // Two free teams per EMAIL, forever: the one that comes with the account and
    // one more. The quota lives on usage_subjects, which no deletion removes, so
    // it cannot be reset by deleting a team, deleting the account, or both.
    //
    // A third team is not an error — it is a paid team. The 402 below is what the
    // client turns into "choose a plan".
    const ownerHash = user.email ? await hashAccountEmail(user.email) : null
    let allocation: Allocation | null = null
    if (ownerHash) {
        const { data: subjects, error: subjErr } = await repoRead(async () => {
            // Teams that predate 0076 have no billing identity yet. Give them one
            // before counting, or their owner reads as having zero teams and gets
            // the whole quota again — lazily, here, because this is the only place
            // the count is used and there is no scheduler to backfill anywhere else.
            await backfillSubjects(ctx, user.id, ownerHash)
            return ctx.usageSubjects.listForOwner(ownerHash)
        })
        if (subjErr) return subjErr

        allocation = new SlotPolicy().allocate(subjects)
        if (!allocation.allowed) {
            return Response.json(
                {
                    error: {
                        code: "plan_required",
                        message: "You're using both of your free teams. Choose a plan to add another.",
                    },
                    freeTeamsInUse: new SlotPolicy().freeTeamsInUse(subjects),
                },
                { status: 402 },
            )
        }
    }

    const { data: teamId, error: rpcErr } = await repoRead(() => ctx.teams.createTeam(name, region, cell, user.id))
    if (rpcErr) return rpcErr

    // Attach the new team to its billing identity — reusing the slot's existing
    // subject when there is one, so a replacement team inherits the balance of the
    // one it replaces instead of starting clean.
    if (ownerHash && allocation?.allowed) {
        try {
            const subjectId = allocation.subjectId ?? (await ctx.usageSubjects.create(ownerHash, allocation.slot))
            await ctx.usageSubjects.bind(subjectId, teamId)
        } catch (e) {
            // An unbound team is a team outside the quota with an untracked
            // allowance — the exact hole this model closes. Roll the team back
            // rather than hand one out: it is seconds old and owns nothing.
            console.error("[teams] usage subject bind failed, rolling back:", (e as Error).message)
            await tryOrNull(() => ctx.teams.delete(teamId))
            return jsonError("billing_error", "couldn't set up billing for the new team — nothing was created", 500)
        }
    }

    // Return the freshly-created team in the same shape the selector consumes.
    // A read-back failure just yields null (best-effort), as before.
    const team = await tryOrNull(() => ctx.teams.findById(teamId))
    const withRole: TeamWithRole | null = team ? { ...team, role: "owner" as TeamRole } : null
    return Response.json({ team: withRole })
}

/** Give a pre-0076 team the billing identity it never had.
 *
 *  Runs only on the create path, and only for teams with no binding: personal
 *  teams take the personal slot, the next one takes the free slot, and anything
 *  beyond that gets a `paid` subject — those teams already exist, and retroactively
 *  refusing them would be punishing people for our schema history rather than for
 *  anything they did.
 *
 *  Best-effort per team: a failure here must not block creating a new one, it just
 *  means that team is counted the next time round. */
async function backfillSubjects(ctx: RequestContext, userId: string, ownerHash: string): Promise<void> {
    const teams = await ctx.teamMembership.listUserTeams(userId)
    // Personal first, then oldest — the same order the slots were designed in, so
    // a backfill assigns them the way a fresh account would have.
    const ordered = [...teams].sort((a, b) => {
        if (a.is_personal !== b.is_personal) return a.is_personal ? -1 : 1
        return (a.created_at ?? "").localeCompare(b.created_at ?? "")
    })

    for (const team of ordered) {
        if (await ctx.usageSubjects.findForTeam(team.id)) continue
        const taken = await ctx.usageSubjects.listForOwner(ownerHash)
        const next = new SlotPolicy().allocate(taken)
        const slot = next.allowed ? next.slot : "paid"
        const subjectId = (next.allowed && next.subjectId) || (await ctx.usageSubjects.create(ownerHash, slot))
        await ctx.usageSubjects.bind(subjectId, team.id)
    }
}
