import { ApiContext, jsonError, repoRead } from "@/lib/server/http/api"
import { tryOrNull } from "@/lib/shared/kernel"
import { AccountDeletionPlanner, getAccountIdentityStore, type TeamFacts } from "@/modules/account"
import { BetaEmail, getBetaWaitlist } from "@/modules/beta"
import type { TeamRole } from "@/lib/shared/types"

// The account itself.
//
//   GET    /api/account  → what deleting it would do (the preflight)
//   DELETE /api/account  → do it
//
// Both answer from the SAME plan (modules/account), so the confirmation screen
// and the operation can never disagree about what is about to happen — the thing
// that makes an irreversible button trustworthy.
//
// The plan refuses outright when the caller is the sole owner of a team that
// still has other members: their teammates' projects are not the departing
// user's to delete. Everything else either goes with them (their personal team,
// and teams where they are alone) or survives without them.

/** Gather the facts the plan needs: every team the caller is in, with their role
 *  and the team's owner/member counts. One membership read per team — a person
 *  belongs to a handful, and this runs at most twice per account, ever. */
async function teamFacts(ctx: Awaited<ReturnType<ApiContext["requireUser"]>>["ctx"], userId: string): Promise<TeamFacts[]> {
    const teams = await ctx.teamMembership.listUserTeams(userId)
    return Promise.all(
        teams.map(async (team) => {
            const members = await ctx.teamMembership.listTeamMembers(team.id)
            return {
                id: team.id,
                name: team.name,
                isPersonal: team.is_personal,
                myRole: team.role as TeamRole,
                ownerCount: members.filter((m) => m.role === "owner").length,
                memberCount: members.length,
            }
        }),
    )
}

/** The wire shape — ids and names only. The counts are internal to the decision;
 *  the screen needs to say WHICH teams, not re-derive WHY. */
const summarise = (teams: TeamFacts[]) => teams.map((t) => ({ id: t.id, name: t.name, isPersonal: t.isPersonal }))

export async function GET() {
    const { ctx, user, error } = await new ApiContext().requireUser()
    if (error) return error

    const { data: facts, error: dbErr } = await repoRead(() => teamFacts(ctx, user.id))
    if (dbErr) return dbErr

    const plan = new AccountDeletionPlanner().plan(facts)
    return Response.json({
        blocked: summarise(plan.blocked),
        willDelete: summarise(plan.toDelete),
        willLeave: summarise(plan.toLeave),
        canProceed: new AccountDeletionPlanner().canProceed(plan),
    })
}

export async function DELETE() {
    const { ctx, user, error } = await new ApiContext().requireUser()
    if (error) return error

    const { data: facts, error: dbErr } = await repoRead(() => teamFacts(ctx, user.id))
    if (dbErr) return dbErr

    const planner = new AccountDeletionPlanner()
    const plan = planner.plan(facts)
    if (!planner.canProceed(plan)) {
        // 409 with the list, not a bare refusal: the only way out is to act on
        // those specific teams, so the response has to name them.
        return Response.json(
            {
                error: {
                    code: "teams_need_owner",
                    message: "Transfer or delete these teams first — you're their only owner.",
                },
                blocked: summarise(plan.blocked),
            },
            { status: 409 },
        )
    }

    // ─── teams that go with the account ──────────────────────────────────────
    for (const team of plan.toDelete) {
        // Re-assert ownership immediately before destroying anything. The facts
        // above were read a moment ago; this is cheap, and "the list said so" is
        // not a good enough reason to delete a team.
        const role = await ctx.access.teamRole(team.id, user.id)
        if (role !== "owner") {
            return jsonError("forbidden", `you're no longer the owner of ${team.name}`, 403)
        }

        // Bind the team's REGION first: a project's issues, comments and
        // embeddings live in its team's cell, and the data plane throws until it
        // is bound. Per team, because two teams can sit in different regions.
        await ctx.bindTeam(team.id)

        // Projects before the team row, for the same reason DELETE /api/teams
        // does it: the central cascade reaches the project rows but cannot reach
        // the regional content they own, so removing the team first would strand
        // that content with nothing left to identify it by.
        const owned = await tryOrNull(() => ctx.projects.listForTeam(team.id, "all"))
        for (const project of owned ?? []) {
            const { error: pErr } = await repoRead(() => ctx.projectDeletion.delete(project.id))
            // Stop on the first failure, leaving the account intact. A half-deleted
            // account is recoverable by pressing the button again; an account
            // deleted with content left behind is not recoverable at all, because
            // the user id that identified it is gone.
            if (pErr) return pErr
        }

        // Release the team from its billing identity BEFORE the row goes. The
        // subject, its ledger and its balance stay behind under the owner's email
        // hash (0076) — which is what stops "delete the account, sign up again"
        // from being a free reset of the monthly allowance. Nothing is copied and
        // nothing expires; the next team this address creates rebinds to it.
        await tryOrNull(() => ctx.usageSubjects.unbind(team.id))

        const { error: tErr } = await repoRead(() => ctx.teams.delete(team.id))
        if (tErr) return tErr
    }

    // ─── teams that survive without them ─────────────────────────────────────
    for (const team of plan.toLeave) {
        const { data: result, error: mErr } = await repoRead(() => ctx.teamMembership.removeMember(team.id, user.id))
        if (mErr) return mErr
        // The last-owner trigger firing here would mean the facts were stale (a
        // co-owner left in the meantime) and this team should have been blocked.
        // Refuse rather than delete the identity and leave an ownerless team.
        if (result === "last_owner") {
            return jsonError(
                "teams_need_owner",
                `${team.name} would be left without an owner — transfer it first.`,
                409,
            )
        }
    }

    // Soft references no foreign key will clean up. The beta QUEUE row goes:
    // somebody who no longer exists should not still be waiting in line. Their
    // beta_allowlist INVITATION stays — it was issued to an address, not to this
    // account, and deleting it would quietly disinvite someone who may sign up
    // again tomorrow.
    const email = BetaEmail.of(user.email)
    if (email) await tryOrNull(() => getBetaWaitlist().remove(email))

    // Last, and only once everything above succeeded: the identity. After this
    // there is no id left to find anything by.
    try {
        await getAccountIdentityStore().delete(user.id)
    } catch (e) {
        console.error("[account] identity deletion failed:", (e as Error).message)
        return jsonError("identity_error", "your data was removed but the login could not be deleted — contact support", 500)
    }

    return new Response(null, { status: 204 })
}
