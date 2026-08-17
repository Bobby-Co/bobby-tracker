import { ApiContext, jsonError } from "@/lib/server/http/api"
import { Supabase } from "@/lib/server/supabase"
import { Email } from "@/modules/teams"
import type { TeamInvite } from "@/lib/shared/types"

// The invitee is not (yet) a team admin, so RLS on team_invites hides the row
// from them. Both handlers look the invite up with the service-role client and
// enforce the "email must match the signed-in user" rule in code.
async function loadInvite(token: string) {
    const svc = Supabase.service()
    const { data } = await svc
        .from("team_invites")
        .select("*")
        .eq("token", token)
        .maybeSingle<TeamInvite>()
    return { svc, invite: data }
}

function inviteState(invite: TeamInvite | null | undefined): { ok: true; invite: TeamInvite } | { ok: false; status: number; reason: string } {
    if (!invite) return { ok: false, status: 404, reason: "invite not found" }
    if (invite.accepted_at) return { ok: false, status: 410, reason: "this invite was already accepted" }
    if (invite.expires_at && Date.parse(invite.expires_at) < Date.now()) return { ok: false, status: 410, reason: "this invite has expired" }
    return { ok: true, invite }
}

// GET /api/invites/[token] — invite summary for the accept page (team name +
// invited email). Public-ish: only reveals the team name and the target email.
export async function GET(_: Request, { params }: { params: Promise<{ token: string }> }) {
    const { token } = await params
    const { svc, invite } = await loadInvite(token)
    const state = inviteState(invite)
    if (!state.ok) return jsonError("invalid_invite", state.reason, state.status)

    const { data: team } = await svc.from("teams").select("name").eq("id", state.invite.team_id).maybeSingle<{ name: string }>()
    return Response.json({
        invite: { email: state.invite.email, role: state.invite.role, team_name: team?.name ?? "a team" },
    })
}

// POST /api/invites/[token] — accept. Requires a signed-in user whose email
// matches the invite; inserts the membership + marks the invite accepted (both
// via service-role, since the invitee can't write team_members under RLS).
export async function POST(_: Request, { params }: { params: Promise<{ token: string }> }) {
    const { token } = await params
    const { user, error } = await new ApiContext().requireUser()
    if (error) return error

    const { svc, invite } = await loadInvite(token)
    const state = inviteState(invite)
    if (!state.ok) return jsonError("invalid_invite", state.reason, state.status)

    const userEmail = Email.of(user.email ?? "").value
    if (!userEmail || userEmail !== Email.of(state.invite.email).value) {
        return jsonError("email_mismatch", "this invite is for a different email address", 403)
    }

    const { error: memErr } = await svc
        .from("team_members")
        .upsert({ team_id: state.invite.team_id, user_id: user.id, role: state.invite.role }, { onConflict: "team_id,user_id" })
    if (memErr) return jsonError("db_error", memErr.message, 500)

    await svc.from("team_invites").update({ accepted_at: new Date().toISOString() }).eq("id", state.invite.id)

    return Response.json({ ok: true, team_id: state.invite.team_id })
}
