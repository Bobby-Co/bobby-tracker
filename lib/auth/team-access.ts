// Central authorisation for the teams model — the "rich logic" half of the
// HYBRID design (see migration 0052). RLS at the database is only a COARSE
// tenant backstop ("you may touch a row iff you're a member of its team"); this
// module is where the finer rules live:
//
//   • which team a request is acting in (the active team),
//   • a member's role (owner / admin / member),
//   • the set of projects a member may actually see (owner/admin ⇒ all team
//     projects; member ⇒ only projects granted to a group they belong to).
//
// Every route handler that needs a role- or group-aware decision goes through
// here rather than re-deriving it, so the logic has ONE source of truth (shared
// with the UI) and is unit-testable. These functions are pure over the Supabase
// client passed in — they never read cookies/headers themselves (lib/api.ts's
// requireTeam does that and hands the resolved value in).

import type { SupabaseClient } from "@supabase/supabase-js"
import type { Team, TeamRole, TeamWithRole } from "@/lib/supabase/types"

// Loosely-typed client: the tracker schema types are hand-written, so `.from`
// results are cast to concrete row shapes at each call site (same convention as
// the rest of the app).
type DB = SupabaseClient

const ROLE_RANK: Record<TeamRole, number> = { member: 1, admin: 2, owner: 3 }

/** True when `role` is at least `min` in the owner > admin > member order. */
export function roleAtLeast(role: TeamRole | null | undefined, min: TeamRole): boolean {
    if (!role) return false
    return ROLE_RANK[role] >= ROLE_RANK[min]
}

/** The caller's teams (each with their own role), personal team first then by
 *  name. Bootstraps a personal team on first use via the ensure_personal_team
 *  RPC — a brand-new user has none yet and there is no auth.users trigger in
 *  this shared-auth setup, so the team is created lazily on first authed read. */
export async function getUserTeams(db: DB, userId: string, personalName?: string): Promise<TeamWithRole[]> {
    const rows = await fetchTeams(db, userId)
    if (rows.length > 0) return rows
    const { error } = await db.rpc("ensure_personal_team", { p_user: userId, p_name: personalName ?? null })
    if (error) throw new Error(`ensure_personal_team failed: ${error.message}`)
    return fetchTeams(db, userId)
}

async function fetchTeams(db: DB, userId: string): Promise<TeamWithRole[]> {
    const { data, error } = await db
        .from("team_members")
        .select("role, teams(*)")
        .eq("user_id", userId)
    if (error) throw new Error(error.message)
    type Row = { role: TeamRole; teams: Team | Team[] | null }
    const teams = ((data ?? []) as Row[])
        .map((r) => {
            // PostgREST returns the embed as an object, but falls back to an
            // array when it can't prove uniqueness — normalise both.
            const t = Array.isArray(r.teams) ? r.teams[0] : r.teams
            return t ? ({ ...t, role: r.role } as TeamWithRole) : null
        })
        .filter((t): t is TeamWithRole => t !== null)
    teams.sort(
        (a, b) => Number(b.is_personal) - Number(a.is_personal) || a.name.localeCompare(b.name),
    )
    return teams
}

/** The caller's role in a specific team, or null if they're not a member.
 *  Use in /api/teams/[id]/* routes, which act on the team named in the URL
 *  rather than the active team. */
export async function getTeamRole(db: DB, teamId: string, userId: string): Promise<TeamRole | null> {
    const { data } = await db
        .from("team_members")
        .select("role")
        .eq("team_id", teamId)
        .eq("user_id", userId)
        .maybeSingle()
    return (data as { role: TeamRole } | null)?.role ?? null
}

/** Resolve which team a request acts in. `requested` is the x-team-id
 *  header/cookie value (may be null / stale); it's honoured only if the caller
 *  is actually a member. Falls back to the personal team, then the first team.
 *  Returns null only if the user somehow has no team even after bootstrap. */
export async function resolveActiveTeam(
    db: DB,
    userId: string,
    requested: string | null,
    personalName?: string,
): Promise<TeamWithRole | null> {
    const teams = await getUserTeams(db, userId, personalName)
    if (teams.length === 0) return null
    if (requested) {
        const hit = teams.find((t) => t.id === requested)
        if (hit) return hit
    }
    return teams.find((t) => t.is_personal) ?? teams[0]
}

/** The projects a caller may access inside a team.
 *   - owner/admin ⇒ "all" (every project the team owns)
 *   - member      ⇒ the distinct set of projects granted to a group they're in
 *  A member in no group returns [] (sees nothing) — matches requirement 5. */
export async function getAccessibleProjectIds(
    db: DB,
    teamId: string,
    userId: string,
    role: TeamRole,
): Promise<"all" | string[]> {
    if (roleAtLeast(role, "admin")) return "all"

    const { data: gm, error: e1 } = await db
        .from("access_group_members")
        .select("group_id")
        .eq("user_id", userId)
        .eq("team_id", teamId)
    if (e1) throw new Error(e1.message)
    const groupIds = ((gm ?? []) as { group_id: string }[]).map((r) => r.group_id)
    if (groupIds.length === 0) return []

    const { data: gp, error: e2 } = await db
        .from("access_group_projects")
        .select("project_id")
        .in("group_id", groupIds)
    if (e2) throw new Error(e2.message)
    return Array.from(new Set(((gp ?? []) as { project_id: string }[]).map((r) => r.project_id)))
}

/** Whether the caller may access a specific project, and the team/role context.
 *  RLS lets any team member READ the project row (coarse gate), so this adds the
 *  group-level check the DB deliberately doesn't: a plain member must have the
 *  project granted to one of their groups. Use it to guard /api/projects/[id]/*
 *  routes that operate on a single project. */
export async function assertProjectAccess(
    db: DB,
    userId: string,
    projectId: string,
): Promise<{ ok: boolean; teamId: string | null; role: TeamRole | null }> {
    const { data: proj } = await db.from("projects").select("team_id").eq("id", projectId).maybeSingle()
    const teamId = (proj as { team_id: string } | null)?.team_id
    if (!teamId) return { ok: false, teamId: null, role: null } // not a team member, or missing

    const { data: mem } = await db
        .from("team_members")
        .select("role")
        .eq("team_id", teamId)
        .eq("user_id", userId)
        .maybeSingle()
    const role = (mem as { role: TeamRole } | null)?.role
    if (!role) return { ok: false, teamId, role: null }

    if (roleAtLeast(role, "admin")) return { ok: true, teamId, role }
    const ids = await getAccessibleProjectIds(db, teamId, userId, role)
    const ok = ids === "all" || ids.includes(projectId)
    return { ok, teamId, role }
}
