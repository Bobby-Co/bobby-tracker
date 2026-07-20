import { after } from "next/server"
import { forbidden, jsonError, requireUser } from "@/lib/platform/http/api"
import { getTeamRole, roleAtLeast } from "@/lib/auth/team-access"
import { baseUrl, isValidEmail, newInviteToken, normalizeEmail, sendInviteEmail } from "@/modules/teams"
import { TEAM_ROLES, type TeamInvite, type TeamRole } from "@/lib/supabase/types"

// GET /api/teams/[id]/invites — pending (unaccepted) invites (admins). RLS on
// team_invites is admin-only, so a non-admin never sees the tokens.
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { supabase, user, error } = await requireUser()
    if (error) return error
    const role = await getTeamRole(supabase, id, user.id)
    if (!role) return jsonError("not_found", "team not found", 404)
    if (!roleAtLeast(role, "admin")) return forbidden("only team admins can view invites")

    const { data, error: dbErr } = await supabase
        .from("team_invites")
        .select("*")
        .eq("team_id", id)
        .is("accepted_at", null)
        .order("created_at", { ascending: false })
    if (dbErr) return jsonError("db_error", dbErr.message, 500)
    return Response.json({ invites: (data ?? []) as TeamInvite[] })
}

// POST /api/teams/[id]/invites — invite an email to the team (admins). Creates a
// pending invite and emails an accept link. Members join when they accept while
// signed in with a matching email (see /api/invites/[token]).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { supabase, user, error } = await requireUser()
    if (error) return error
    const role = await getTeamRole(supabase, id, user.id)
    if (!role) return jsonError("not_found", "team not found", 404)
    if (!roleAtLeast(role, "admin")) return forbidden("only team admins can invite")

    let body: Record<string, unknown>
    try { body = await request.json() } catch { return jsonError("bad_request", "invalid JSON", 400) }
    const email = normalizeEmail(String(body?.email ?? ""))
    if (!isValidEmail(email)) return jsonError("bad_request", "a valid email is required", 400)
    const inviteRole = (TEAM_ROLES.includes(body?.role as TeamRole) ? body.role : "member") as TeamRole
    if (inviteRole === "owner") return jsonError("bad_request", "cannot invite as owner", 400)

    const token = newInviteToken()
    const expires_at = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

    const { data: invite, error: dbErr } = await supabase
        .from("team_invites")
        .insert({ team_id: id, email, role: inviteRole, token, invited_by: user.id, expires_at })
        .select("*")
        .single<TeamInvite>()
    if (dbErr) {
        // 23505 = the partial-unique "one live invite per email per team"
        if (dbErr.code === "23505") return jsonError("conflict", "there's already a pending invite for that email", 409)
        return jsonError("db_error", dbErr.message, 500)
    }

    // Resolve the team name + inviter for the email; send post-response so a slow
    // SMTP host can't stall the request. Best-effort: a send failure leaves the
    // invite live to resend.
    const { data: team } = await supabase.from("teams").select("name").eq("id", id).maybeSingle<{ name: string }>()
    const inviterName =
        (user.user_metadata?.full_name as string) || (user.user_metadata?.name as string) || null
    const acceptUrl = `${baseUrl(request)}/invite/${token}`
    after(async () => {
        try {
            await sendInviteEmail({ to: email, teamName: team?.name ?? "a team", inviterName, acceptUrl, role: inviteRole })
        } catch (e) {
            console.error("[team invite] email send failed", id, email, e)
        }
    })

    return Response.json({ invite })
}
