import { after } from "next/server"
import { ApiContext, forbidden, jsonError, repoRead } from "@/lib/server/http/api"
import { Role } from "@/modules/access"
import { Email, Invite, createTeamMailer } from "@/modules/teams"
import { TEAM_ROLES, type TeamRole } from "@/lib/shared/types"

// GET /api/teams/[id]/invites — pending (unaccepted) invites (admins). RLS on
// team_invites is admin-only, so a non-admin never sees the tokens.
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { ctx, user, error } = await new ApiContext().requireUser()
    if (error) return error
    const role = await ctx.access.teamRole(id, user.id)
    if (!role) return jsonError("not_found", "team not found", 404)
    if (!Role.of(role).atLeast("admin")) return forbidden("only team admins can view invites")

    const { data: invites, error: dbErr } = await repoRead(() => ctx.teamInvites.listPending(id))
    if (dbErr) return dbErr
    return Response.json({ invites })
}

// POST /api/teams/[id]/invites — invite an email to the team (admins). Creates a
// pending invite and emails an accept link. Members join when they accept while
// signed in with a matching email (see /api/invites/[token]).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { ctx, user, error } = await new ApiContext().requireUser()
    if (error) return error
    const role = await ctx.access.teamRole(id, user.id)
    if (!role) return jsonError("not_found", "team not found", 404)
    if (!Role.of(role).atLeast("admin")) return forbidden("only team admins can invite")

    let body: Record<string, unknown>
    try { body = await request.json() } catch { return jsonError("bad_request", "invalid JSON", 400) }
    const emailVo = Email.of(String(body?.email ?? ""))
    if (!emailVo.isValid()) return jsonError("bad_request", "a valid email is required", 400)
    const email = emailVo.value
    const inviteRole = (TEAM_ROLES.includes(body?.role as TeamRole) ? body.role : "member") as TeamRole
    if (inviteRole === "owner") return jsonError("bad_request", "cannot invite as owner", 400)

    const inviteVo = new Invite()
    const token = inviteVo.newToken()
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

    const { data: result, error: dbErr } = await repoRead(() =>
        ctx.teamInvites.create({ teamId: id, email, role: inviteRole, token, invitedBy: user.id, expiresAt }),
    )
    if (dbErr) return dbErr
    if (!result.ok) return jsonError("conflict", "there's already a pending invite for that email", 409)

    // Resolve the team name + inviter for the email; send post-response so a slow
    // SMTP host can't stall the request. Best-effort: a send failure leaves the
    // invite live to resend.
    const teamName = await ctx.teams.findName(id)
    const inviterName =
        (user.user_metadata?.full_name as string) || (user.user_metadata?.name as string) || null
    const acceptUrl = inviteVo.acceptUrl(request, token)
    after(async () => {
        try {
            await createTeamMailer().sendInvite({ to: email, teamName: teamName ?? "a team", inviterName, acceptUrl, role: inviteRole })
        } catch (e) {
            console.error("[team invite] email send failed", id, email, e)
        }
    })

    return Response.json({ invite: result.invite })
}
