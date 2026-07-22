import { ApiContext, jsonError } from "@/lib/server/http/api"
import { getAccessService } from "@/modules/access"
import { toMemberViews } from "@/lib/server/auth/user-profiles"
import type { TeamRole } from "@/lib/shared/types"

// GET /api/teams/[id]/members — team members with resolved profiles (any member
// may view the roster). Profiles come from the service-role admin API since
// auth.users isn't readable by `authenticated`.
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { supabase, user, error } = await new ApiContext().requireUser()
    if (error) return error
    const role = await getAccessService(supabase).teamRole(id, user.id)
    if (!role) return jsonError("not_found", "team not found", 404)

    const { data, error: dbErr } = await supabase
        .from("team_members")
        .select("user_id, role, created_at")
        .eq("team_id", id)
    if (dbErr) return jsonError("db_error", dbErr.message, 500)

    const rows = (data ?? []) as { user_id: string; role: TeamRole; created_at: string }[]
    const members = await toMemberViews(rows)
    // owners first, then admins, then members; stable within a rank by join time
    const rank: Record<TeamRole, number> = { owner: 0, admin: 1, member: 2 }
    members.sort((a, b) => rank[a.role] - rank[b.role] || a.created_at.localeCompare(b.created_at))
    return Response.json({ members })
}
