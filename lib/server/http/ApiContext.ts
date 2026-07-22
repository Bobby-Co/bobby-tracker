// ApiContext — the request-authorization guard object a route constructs to
// answer "who is calling, in which team, and may they touch this resource?". It
// replaces the loose require* functions that used to live in ./api: each guard is
// now a method with a clear owner, and the team-aware guards read the x-team-id
// header off the Request the context is built with (`new ApiContext(request)`).
//
// It depends on a SessionGateway (port) for the current user + a request-scoped
// unit of work (RequestContext) — it does NOT import the DB SDK. Authorization
// decisions and the team-owned-row reads go through the RequestContext's module
// repositories (ctx.access, ctx.issues, …); there is no raw `.from()` here, and no
// Supabase construction. The pure response builders (jsonError/forbidden) stay
// free functions in ./responses.
//
// TRANSITIONAL: each guard result still carries `supabase` (= ctx.client) so
// not-yet-migrated routes compile. Routes are being moved onto `ctx.<repo>`;
// once none read `supabase`, the field and RequestContext.client are removed.

import { cookies } from "next/headers"
import type { User } from "@supabase/supabase-js"
import type { SupabaseRlsClient } from "@/lib/server/supabase"
import { Role } from "@/modules/access"
import { tryOrNull } from "@/lib/shared/kernel"
import { jsonError, forbidden } from "./responses"
import { getSessionGateway } from "./SessionGateway"
import type { RequestContext } from "./RequestContext"
import type { TeamRole, TeamWithRole } from "@/lib/shared/types"

type SupabaseServer = SupabaseRlsClient

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

// ─── result unions — the authz facts + the request unit of work (ctx). `supabase`
//     is the transitional raw-client escape hatch (see file header). ────────────
export type AuthSuccess = { ctx: RequestContext; supabase: SupabaseServer; user: User; error: null }
export type AuthFailure = { ctx: RequestContext; supabase: SupabaseServer; user: null; error: Response }

export type TeamSuccess = {
    ctx: RequestContext
    supabase: SupabaseServer
    user: User
    team: TeamWithRole
    teamId: string
    role: TeamRole
    error: null
}
export type TeamFailure = {
    ctx: RequestContext
    supabase: SupabaseServer
    user: User | null
    team: null
    teamId: null
    role: null
    error: Response
}

export type ProjectSuccess = { ctx: RequestContext; supabase: SupabaseServer; user: User; teamId: string; role: TeamRole; error: null }
export type ProjectFailure = { ctx: RequestContext; supabase: SupabaseServer; user: null; teamId: null; role: null; error: Response }

export type IssueSuccess = { ctx: RequestContext; supabase: SupabaseServer; user: User; projectId: string; teamId: string; role: TeamRole; error: null }
export type IssueFailure = { ctx: RequestContext; supabase: SupabaseServer; user: null; projectId: null; teamId: null; role: null; error: Response }

export type TeamRowSuccess = { ctx: RequestContext; supabase: SupabaseServer; user: User; teamId: string; role: TeamRole; isCreator: boolean; error: null }
export type TeamRowFailure = { ctx: RequestContext; supabase: SupabaseServer; user: null; teamId: null; role: null; isCreator: false; error: Response }

export class ApiContext {
    private readonly session = getSessionGateway()

    /** Pass the Request so team-aware guards honour the x-team-id header (the
     *  `team_id` cookie is the fallback). Route-scoped guards that don't need the
     *  header can be built with `new ApiContext()`. */
    constructor(private readonly request?: Request) {}

    async requireUser(): Promise<AuthSuccess | AuthFailure> {
        // Run the (cached) auth check and the unit-of-work setup in parallel —
        // they don't depend on each other.
        const [user, ctx] = await Promise.all([this.session.currentUser(), this.session.openContext()])
        const supabase = ctx.client
        if (!user) {
            return { ctx, supabase, user: null, error: jsonError("unauthorized", "sign in required", 401) }
        }
        return { ctx, supabase, user, error: null }
    }

    /** requireUser + resolve the active team (with the caller's role in it).
     *  Bootstraps the personal team on first use. Honours the x-team-id header from
     *  the Request this context was built with; the `team_id` cookie is the fallback. */
    async requireTeam(): Promise<TeamSuccess | TeamFailure> {
        const base = await this.requireUser()
        if (base.error) {
            return { ctx: base.ctx, supabase: base.supabase, user: null, team: null, teamId: null, role: null, error: base.error }
        }
        const { ctx, supabase, user } = base

        const fromHeader = this.request?.headers.get(TEAM_HEADER) || null
        const fromCookie = fromHeader ? null : (await cookies()).get(TEAM_COOKIE)?.value || null
        const requested = fromHeader || fromCookie

        let team: TeamWithRole | null
        try {
            team = await ctx.access.resolveActiveTeam(user.id, requested, personalTeamName(user))
        } catch (e) {
            return {
                ctx, supabase, user: null, team: null, teamId: null, role: null,
                error: jsonError("team_error", e instanceof Error ? e.message : "team resolve failed", 500),
            }
        }
        if (!team) {
            return {
                ctx, supabase, user: null, team: null, teamId: null, role: null,
                error: jsonError("no_team", "no accessible team", 500),
            }
        }
        return { ctx, supabase, user, team, teamId: team.id, role: team.role, error: null }
    }

    /** Guard: returns a 403 Response if `role` is below `min`, else null. */
    requireRole(role: TeamRole, min: TeamRole): Response | null {
        return Role.of(role).atLeast(min) ? null : forbidden(`requires ${min} role`)
    }

    /** requireUser + enforce the group-level access rule for a single project. The
     *  coarse RLS backstop only proves TEAM membership; this adds the finer gate a
     *  plain member is subject to (they must have the project granted to one of their
     *  groups; admins/owners always pass). Returns a 404 when the caller can't access
     *  the project — matching the project detail route, so we don't reveal existence. */
    async requireProjectAccess(projectId: string): Promise<ProjectSuccess | ProjectFailure> {
        const base = await this.requireUser()
        if (base.error) return { ctx: base.ctx, supabase: base.supabase, user: null, teamId: null, role: null, error: base.error }
        const { ctx, supabase, user } = base
        const access = await ctx.access.canAccessProject(user.id, projectId)
        if (!access.ok || !access.teamId || !access.role) {
            return { ctx, supabase, user: null, teamId: null, role: null, error: jsonError("not_found", "project not found", 404) }
        }
        return { ctx, supabase, user, teamId: access.teamId, role: access.role, error: null }
    }

    /** requireUser + resolve the issue's owning project + enforce the SAME
     *  group-level access rule as requireProjectAccess. The top-level
     *  /api/issues/[id]/** routes operate on an issue by id; without this they fell
     *  back to the coarse team RLS backstop, letting a member OUTSIDE the project's
     *  group read/mutate/delete it. 404 on no access (don't reveal existence). */
    async requireIssueAccess(issueId: string): Promise<IssueSuccess | IssueFailure> {
        const base = await this.requireUser()
        if (base.error) return { ctx: base.ctx, supabase: base.supabase, user: null, projectId: null, teamId: null, role: null, error: base.error }
        const { ctx, supabase, user } = base

        // Coarse RLS lets a team member read the issue row; we still resolve its
        // project to apply the finer group gate. null when the issue is
        // invisible/absent, which we render as 404 (same as no-access). Fail-safe:
        // a query error also folds to null → 404 (fail closed), as before.
        const projectId = await tryOrNull(() => ctx.issues.findProjectId(issueId))
        const notFound: IssueFailure = { ctx, supabase, user: null, projectId: null, teamId: null, role: null, error: jsonError("not_found", "issue not found", 404) }
        if (!projectId) return notFound

        const access = await ctx.access.canAccessProject(user.id, projectId)
        if (!access.ok || !access.teamId || !access.role) return notFound
        return { ctx, supabase, user, projectId, teamId: access.teamId, role: access.role, error: null }
    }

    /** Team-owned Collection (project_groups) guard. `{ write: true }` for mutations. */
    requireCollectionAccess(id: string, opts?: { write?: boolean }): Promise<TeamRowSuccess | TeamRowFailure> {
        return this.requireTeamRowAccess("project_groups", id, opts)
    }

    /** Team-owned public submission session (public_sessions) guard. `{ write: true }` for mutations. */
    requireSessionAccess(id: string, opts?: { write?: boolean }): Promise<TeamRowSuccess | TeamRowFailure> {
        return this.requireTeamRowAccess("public_sessions", id, opts)
    }

    /** Guard for a TEAM-OWNED resource keyed by (team_id, user_id=creator) —
     *  project_groups (Collections) and public_sessions. Coarse RLS already blocks
     *  CROSS-team access; this adds the intra-team rule the DB doesn't: a MUTATION
     *  (opts.write) requires the caller to be the creator OR a team admin/owner, so
     *  a plain member can't edit/delete another member's Collection or session.
     *  Reads only need membership. 404 when the row is absent or the caller isn't a
     *  member (don't reveal existence); 403 when a member mutates what they don't own.
     *
     *  POLICY NOTE: "creator-or-admin" is a deliberate, conservative default — adjust
     *  here (one place) if the product wants member-wide edit or strict admin-only.
     *  The ownership row is read through the owning module's repository. */
    private async requireTeamRowAccess(
        table: "project_groups" | "public_sessions",
        id: string,
        opts?: { write?: boolean },
    ): Promise<TeamRowSuccess | TeamRowFailure> {
        const base = await this.requireUser()
        if (base.error) return { ctx: base.ctx, supabase: base.supabase, user: null, teamId: null, role: null, isCreator: false, error: base.error }
        const { ctx, supabase, user } = base
        const notFound: TeamRowFailure = { ctx, supabase, user: null, teamId: null, role: null, isCreator: false, error: jsonError("not_found", "not found", 404) }

        const row =
            table === "project_groups"
                ? await ctx.teamMembership.findCollectionOwnership(id)
                : await ctx.publicSessions.findOwnership(id)
        if (!row?.team_id) return notFound

        const role = await ctx.access.teamRole(row.team_id, user.id)
        if (!role) return notFound

        const isCreator = row.user_id === user.id
        if (opts?.write && !isCreator && !Role.of(role).atLeast("admin")) {
            return { ctx, supabase, user: null, teamId: null, role: null, isCreator: false, error: forbidden("only the creator or a team admin can change this") }
        }
        return { ctx, supabase, user, teamId: row.team_id, role, isCreator, error: null }
    }
}
