// Shared helpers for tracker API route handlers.

import { cookies } from "next/headers"
import type { User } from "@supabase/supabase-js"
import { createClient, getCurrentUser } from "@/lib/supabase/server"
import { assertProjectAccess, getTeamRole, resolveActiveTeam, roleAtLeast } from "@/lib/auth/team-access"
import { RepositoryError, tryOrNull } from "@/lib/kernel"
import { createSupabaseIssuesRepository } from "@/modules/issues"
import type { TeamRole, TeamWithRole } from "@/lib/supabase/types"

type SupabaseServer = Awaited<ReturnType<typeof createClient>>

export function jsonError(code: string, message: string, status: number) {
    return Response.json({ error: { code, message } }, { status })
}

/** 403 for an authenticated caller who lacks the required role/access. */
export function forbidden(message = "you don't have access to this resource") {
    return jsonError("forbidden", message, 403)
}

/** Run a repository read and map a RepositoryError to a `db_error` 500 Response,
 *  so a handler can early-return it. Mirrors the `{ data, error }` shape of the
 *  raw supabase call it replaces: `data` is the row (or null when absent), `error`
 *  is a ready-to-return Response on infrastructure failure. A non-repository error
 *  (a real bug) still throws. */
export async function repoRead<T>(
    fn: () => Promise<T>,
): Promise<{ data: T; error: null } | { data: null; error: Response }> {
    try {
        return { data: await fn(), error: null }
    } catch (e) {
        if (e instanceof RepositoryError) return { data: null, error: jsonError("db_error", e.message, 500) }
        throw e
    }
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

type IssueOK = { supabase: SupabaseServer; user: User; projectId: string; teamId: string; role: TeamRole; error: null }
type IssueFail = { supabase: SupabaseServer; user: null; projectId: null; teamId: null; role: null; error: Response }

/** requireUser + resolve the issue's owning project + enforce the SAME
 *  group-level access rule as requireProjectAccess. The top-level
 *  /api/issues/[id]/** routes operate on an issue by id; without this they fell
 *  back to the coarse team RLS backstop, letting a member OUTSIDE the project's
 *  group read/mutate/delete it — the gap the parallel /api/projects/[id]/issues
 *  routes already close. 404 on no access (don't reveal existence), matching
 *  requireProjectAccess. Use in every /api/issues/[id]/** route:
 *  `requireIssueAccess(id)`. */
export async function requireIssueAccess(issueId: string): Promise<IssueOK | IssueFail> {
    const base = await requireUser()
    if (base.error) return { supabase: base.supabase, user: null, projectId: null, teamId: null, role: null, error: base.error }
    const { supabase, user } = base

    // Coarse RLS lets a team member read the issue row; we still resolve its
    // project to apply the finer group gate. null when the issue is
    // invisible/absent, which we render as 404 (same as no-access). Fail-safe:
    // a query error also folds to null → 404 (fail closed), as before.
    const projectId = await tryOrNull(() => createSupabaseIssuesRepository(supabase).findProjectId(issueId))
    const notFound: IssueFail = { supabase, user: null, projectId: null, teamId: null, role: null, error: jsonError("not_found", "issue not found", 404) }
    if (!projectId) return notFound

    const access = await assertProjectAccess(supabase, user.id, projectId)
    if (!access.ok || !access.teamId || !access.role) return notFound
    return { supabase, user, projectId, teamId: access.teamId, role: access.role, error: null }
}

type TeamRowOK = { supabase: SupabaseServer; user: User; teamId: string; role: TeamRole; isCreator: boolean; error: null }
type TeamRowFail = { supabase: SupabaseServer; user: null; teamId: null; role: null; isCreator: false; error: Response }

/** Guard for a TEAM-OWNED resource keyed by (team_id, user_id=creator) —
 *  project_groups (Collections) and public_sessions. Coarse RLS already blocks
 *  CROSS-team access; this adds the intra-team rule the DB doesn't: a MUTATION
 *  (opts.write) requires the caller to be the creator OR a team admin/owner, so
 *  a plain member can't edit/delete another member's Collection or session.
 *  Reads only need membership. 404 when the row is absent or the caller isn't a
 *  member (don't reveal existence); 403 when a member mutates what they don't own.
 *
 *  POLICY NOTE: "creator-or-admin" is a deliberate, conservative default — adjust
 *  here (one place) if the product wants member-wide edit or strict admin-only. */
async function requireTeamRowAccess(
    table: "project_groups" | "public_sessions",
    id: string,
    opts?: { write?: boolean },
): Promise<TeamRowOK | TeamRowFail> {
    const base = await requireUser()
    if (base.error) return { supabase: base.supabase, user: null, teamId: null, role: null, isCreator: false, error: base.error }
    const { supabase, user } = base
    const notFound: TeamRowFail = { supabase, user: null, teamId: null, role: null, isCreator: false, error: jsonError("not_found", "not found", 404) }

    const { data: row } = await supabase.from(table).select("team_id,user_id").eq("id", id).maybeSingle()
    const r = row as { team_id: string; user_id: string } | null
    if (!r?.team_id) return notFound

    const role = await getTeamRole(supabase, r.team_id, user.id)
    if (!role) return notFound

    const isCreator = r.user_id === user.id
    if (opts?.write && !isCreator && !roleAtLeast(role, "admin")) {
        return { supabase, user: null, teamId: null, role: null, isCreator: false, error: forbidden("only the creator or a team admin can change this") }
    }
    return { supabase, user, teamId: r.team_id, role, isCreator, error: null }
}

/** Team-owned Collection (project_groups) guard. `{ write: true }` for mutations. */
export function requireCollectionAccess(id: string, opts?: { write?: boolean }): Promise<TeamRowOK | TeamRowFail> {
    return requireTeamRowAccess("project_groups", id, opts)
}

/** Team-owned public submission session (public_sessions) guard. `{ write: true }` for mutations. */
export function requireSessionAccess(id: string, opts?: { write?: boolean }): Promise<TeamRowOK | TeamRowFail> {
    return requireTeamRowAccess("public_sessions", id, opts)
}
