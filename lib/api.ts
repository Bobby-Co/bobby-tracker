// Shared helpers for tracker API route handlers.

import { cookies } from "next/headers"
import type { User } from "@supabase/supabase-js"
import { createClient, getCurrentUser } from "@/lib/supabase/server"
import { assertProjectAccess, resolveActiveTeam, roleAtLeast } from "@/lib/auth/team-access"
import type { TeamRole, TeamWithRole } from "@/lib/supabase/types"

type SupabaseServer = Awaited<ReturnType<typeof createClient>>

export function jsonError(code: string, message: string, status: number) {
    return Response.json({ error: { code, message } }, { status })
}

/** 403 for an authenticated caller who lacks the required role/access. */
export function forbidden(message = "you don't have access to this resource") {
    return jsonError("forbidden", message, 403)
}

type AuthOK   = { supabase: SupabaseServer; user: User;  error: null }
type AuthFail = { supabase: SupabaseServer; user: null;  error: Response }

export async function requireUser(): Promise<AuthOK | AuthFail> {
    // Run the (cached) auth check and the cookie-bound client setup
    // in parallel — they don't depend on each other.
    const [user, supabase] = await Promise.all([getCurrentUser(), createClient()])
    if (!user) {
        return { supabase, user: null, error: jsonError("unauthorized", "sign in required", 401) }
    }
    return { supabase, user, error: null }
}

// The header/cookie the client uses to say which team it's acting in. The
// TeamProvider (client) mirrors the active team into both; requireTeam prefers
// the header (set per-fetch) and falls back to the cookie (set once).
export const TEAM_HEADER = "x-team-id"
export const TEAM_COOKIE = "team_id"

/** "<Display>'s Personal Team" — the name given to a lazily-created personal
 *  team, matching the backfill in migration 0052. */
export function personalTeamName(user: User): string {
    const name =
        (user.user_metadata?.full_name as string) ||
        (user.user_metadata?.name as string) ||
        user.email?.split("@")[0] ||
        "My"
    return `${name}'s Personal Team`
}

type TeamOK = {
    supabase: SupabaseServer
    user: User
    team: TeamWithRole
    teamId: string
    role: TeamRole
    error: null
}
type TeamFail = {
    supabase: SupabaseServer
    user: User | null
    team: null
    teamId: null
    role: null
    error: Response
}

/** requireUser + resolve the active team (with the caller's role in it).
 *  Bootstraps the personal team on first use. Pass the Request so the
 *  x-team-id header is honoured; the `team_id` cookie is the fallback. */
export async function requireTeam(request?: Request): Promise<TeamOK | TeamFail> {
    const base = await requireUser()
    if (base.error) {
        return { supabase: base.supabase, user: null, team: null, teamId: null, role: null, error: base.error }
    }
    const { supabase, user } = base

    const fromHeader = request?.headers.get(TEAM_HEADER) || null
    const fromCookie = fromHeader ? null : (await cookies()).get(TEAM_COOKIE)?.value || null
    const requested = fromHeader || fromCookie

    let team: TeamWithRole | null
    try {
        team = await resolveActiveTeam(supabase, user.id, requested, personalTeamName(user))
    } catch (e) {
        return {
            supabase, user: null, team: null, teamId: null, role: null,
            error: jsonError("team_error", e instanceof Error ? e.message : "team resolve failed", 500),
        }
    }
    if (!team) {
        return {
            supabase, user: null, team: null, teamId: null, role: null,
            error: jsonError("no_team", "no accessible team", 500),
        }
    }
    return { supabase, user, team, teamId: team.id, role: team.role, error: null }
}

/** Guard: returns a 403 Response if `role` is below `min`, else null. */
export function requireRole(role: TeamRole, min: TeamRole): Response | null {
    return roleAtLeast(role, min) ? null : forbidden(`requires ${min} role`)
}

type ProjectOK = { supabase: SupabaseServer; user: User; teamId: string; role: TeamRole; error: null }
type ProjectFail = { supabase: SupabaseServer; user: null; teamId: null; role: null; error: Response }

/** requireUser + enforce the group-level access rule for a single project. The
 *  coarse RLS backstop only proves TEAM membership; this adds the finer gate a
 *  plain member is subject to (they must have the project granted to one of their
 *  groups; admins/owners always pass). Returns a 404 when the caller can't access
 *  the project — matching the project detail route, so we don't reveal existence.
 *  Use in every /api/projects/[id]/** route: `requireProjectAccess(id)`. */
export async function requireProjectAccess(projectId: string): Promise<ProjectOK | ProjectFail> {
    const base = await requireUser()
    if (base.error) return { supabase: base.supabase, user: null, teamId: null, role: null, error: base.error }
    const { supabase, user } = base
    const access = await assertProjectAccess(supabase, user.id, projectId)
    if (!access.ok || !access.teamId || !access.role) {
        return { supabase, user: null, teamId: null, role: null, error: jsonError("not_found", "project not found", 404) }
    }
    return { supabase, user, teamId: access.teamId, role: access.role, error: null }
}
