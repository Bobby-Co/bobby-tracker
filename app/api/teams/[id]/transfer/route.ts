import { ApiContext, forbidden, jsonError, repoRead } from "@/lib/server/http/api"

// POST /api/teams/[id]/transfer  { userId }
//
// Hand the team to somebody else: promote them to owner, then step down to
// admin. Owner-only, and the caller must not be transferring to themselves.
//
// It exists as ONE route rather than two PATCHes from the client because the
// pair is a single intent with an unsafe halfway point. Done in the wrong order —
// step down first — the last-owner trigger rejects it and nothing happens, which
// is at least safe; done from the client, a dropped connection between the two
// calls leaves a team with two owners and no way for the UI to explain why.
//
// Here the order is fixed and the failure mode is chosen: promote first, so an
// interruption leaves the team with an EXTRA owner. That is recoverable by
// anyone, from the members list, and it never leaves a team unowned.
//
// The departing owner becomes an ADMIN rather than being removed. Transferring a
// team is not the same as leaving it, and someone who wanted both can leave from
// the members list afterwards — an explicit second step, not a surprise.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { ctx, user, error } = await new ApiContext().requireUser()
    if (error) return error

    const role = await ctx.access.teamRole(id, user.id)
    if (!role) return jsonError("not_found", "team not found", 404)
    if (role !== "owner") return forbidden("only the team owner can transfer a team")

    let body: Record<string, unknown>
    try { body = await request.json() } catch { return jsonError("bad_request", "invalid JSON", 400) }
    const userId = String(body?.userId ?? "").trim()
    if (!userId) return jsonError("bad_request", "userId is required", 400)
    if (userId === user.id) return jsonError("bad_request", "you already own this team", 400)

    if (await ctx.teams.isPersonal(id)) {
        // A personal team is bootstrapped from its owner and cannot hold anyone
        // else, so there is nobody to transfer it to.
        return jsonError("bad_request", "a personal team can't be transferred", 400)
    }

    // Must already be a member — this promotes, it does not invite.
    const targetRole = await ctx.access.teamRole(id, userId)
    if (!targetRole) return jsonError("bad_request", "that person isn't a member of this team", 400)

    const { error: promoteErr } = await repoRead(() => ctx.teamMembership.updateMemberRole(id, userId, "owner"))
    if (promoteErr) return promoteErr

    const { data: stepDown, error: demoteErr } = await repoRead(() =>
        ctx.teamMembership.updateMemberRole(id, user.id, "admin"),
    )
    if (demoteErr) return demoteErr
    // Can't happen — the promotion above means there are two owners — but if the
    // trigger ever did fire, say so plainly rather than reporting a transfer that
    // left the caller in charge.
    if (stepDown === "last_owner") {
        return jsonError("conflict", "the team still has you as its only owner — try again", 409)
    }

    return new Response(null, { status: 204 })
}
