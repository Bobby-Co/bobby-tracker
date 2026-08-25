import { ApiContext, forbidden, jsonError, repoRead } from "@/lib/server/http/api"
import { tryOrNull } from "@/lib/shared/kernel"
import { Role } from "@/modules/access"
import { createServiceAdminUserDirectory, createTeamMailer } from "@/modules/teams"
import { TEAM_ROLES, type TeamRole } from "@/lib/shared/types"

/** Who to tell, and what to call them. Resolved through the member views (the
 *  service-role auth directory) because a membership row holds a user id and
 *  nothing else — no email, no name.
 *
 *  Best-effort throughout: a change that already committed must not be reported
 *  as a failure because a lookup for a courtesy email didn't resolve. */
async function notifyParties(teamId: string, subjectId: string, actorId: string) {
    const profiles = await tryOrNull(() => createServiceAdminUserDirectory().resolveProfiles([subjectId, actorId]))
    const subject = profiles?.get(subjectId) ?? null
    return {
        to: subject?.email ?? null,
        name: subject?.name ?? null,
        actorName: profiles?.get(actorId)?.name ?? null,
    }
}

/** The team's display name, for a mail that has to say WHICH team. */
async function teamName(ctx: Awaited<ReturnType<ApiContext["requireUser"]>>["ctx"], teamId: string): Promise<string> {
    return (await tryOrNull(() => ctx.teams.findName(teamId))) ?? "your team"
}

// PATCH /api/teams/[id]/members/[userId] — change a member's role (admins). The
// DB last-owner trigger blocks demoting the final owner.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; userId: string }> }) {
    const { id, userId } = await params
    const { ctx, user, error } = await new ApiContext().requireUser()
    if (error) return error
    const role = await ctx.access.teamRole(id, user.id)
    if (!role) return jsonError("not_found", "team not found", 404)
    if (!Role.of(role).atLeast("admin")) return forbidden("only team admins can change roles")

    let body: Record<string, unknown>
    try { body = await request.json() } catch { return jsonError("bad_request", "invalid JSON", 400) }
    const next = String(body?.role ?? "") as TeamRole
    if (!TEAM_ROLES.includes(next)) return jsonError("bad_request", "invalid role", 400)
    // Only an owner may promote another member to owner.
    if (next === "owner" && role !== "owner") return forbidden("only an owner can promote to owner")

    // Read the role they hold BEFORE the update — the mail's whole subject is the
    // difference between the two, and after the write the old value is gone.
    const previous = await ctx.access.teamRole(id, userId)

    const { data: result, error: dbErr } = await repoRead(() => ctx.teamMembership.updateMemberRole(id, userId, next))
    if (dbErr) return dbErr
    // 23514 = last-owner trigger; can't change the final owner's role.
    if (result === "last_owner") return jsonError("conflict", "the last owner's role can't be changed", 409)

    // Tell them — unless they changed their own role, in which case they were
    // looking at the screen when it happened. A no-op change (same role in and
    // out) is not news either.
    if (userId !== user.id && previous && previous !== next) {
        const who = await notifyParties(id, userId, user.id)
        if (who.to) {
            await createTeamMailer().sendRoleChanged({
                to: who.to,
                name: who.name,
                teamName: await teamName(ctx, id),
                previous: previous as TeamRole,
                current: next,
                actorName: who.actorName,
            })
        }
    }

    return new Response(null, { status: 204 })
}

// DELETE /api/teams/[id]/members/[userId] — remove a member (admins), or a member
// removing themselves (leave). The last-owner trigger protects the final owner.
export async function DELETE(_: Request, { params }: { params: Promise<{ id: string; userId: string }> }) {
    const { id, userId } = await params
    const { ctx, user, error } = await new ApiContext().requireUser()
    if (error) return error
    const role = await ctx.access.teamRole(id, user.id)
    if (!role) return jsonError("not_found", "team not found", 404)
    const isSelf = userId === user.id
    if (!isSelf && !Role.of(role).atLeast("admin")) return forbidden("only team admins can remove members")

    // Resolved BEFORE the removal: the membership row is what the directory
    // lookup hangs off, and once it's gone there is nobody left to address.
    const who = isSelf ? null : await notifyParties(id, userId, user.id)
    const name = isSelf ? "" : await teamName(ctx, id)

    const { data: result, error: dbErr } = await repoRead(() => ctx.teamMembership.removeMember(id, userId))
    if (dbErr) return dbErr
    if (result === "last_owner") return jsonError("conflict", "the last owner can't leave — transfer ownership first", 409)

    // Only when someone ELSE removed them. Leaving is a thing you just did, on a
    // screen you were looking at; an email confirming it is noise.
    if (who?.to) {
        await createTeamMailer().sendRemovedFromTeam({ to: who.to, name: who.name, teamName: name, actorName: who.actorName })
    }

    return new Response(null, { status: 204 })
}
