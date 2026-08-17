// Teams module — membership/access-control repository PORT. The team, access
// group, and collection (project-group) tables are Teams-owned; other contexts
// (e.g. notification fan-out, public-session resolution, the access module's
// authz decisions) read them ONLY through this contract instead of querying the
// tables directly.
//
// ports/ may reference a shared row type, but here the shapes are small and
// local. Concrete persistence lives in ../infrastructure.

import type { TeamRole, TeamWithRole } from "@/lib/shared/types"

export interface TeamMember {
    user_id: string
    role: "owner" | "admin" | "member"
}

/** A member row for the management roster (enriched with profiles downstream). */
export interface TeamMemberDetail {
    user_id: string
    role: TeamRole
    created_at: string
}

/** Outcome of a member-mutating write: "ok", or "last_owner" when the DB
 *  last-owner trigger (check_violation 23514) blocked demoting/removing the final
 *  owner — the route maps that to a 409 rather than a 500. */
export type MemberWriteResult = "ok" | "last_owner"

export interface TeamMembershipRepository {
    /** Every member of a team with their role. THROWS RepositoryError on a query
     *  failure (callers treat a broken store as fatal, not as "no members"). */
    listTeamMembers(teamId: string): Promise<TeamMember[]>

    /** Access-group ids that grant a project (raw; may repeat). Throws on failure. */
    listGroupIdsForProject(projectId: string): Promise<string[]>

    /** User ids belonging to the given access groups within a team. Throws on failure. */
    listGroupMemberUserIds(teamId: string, groupIds: string[]): Promise<string[]>

    /** Project ids in a collection (project group) whose public integration is
     *  enabled — the group access mode of a public session. Fail-safe (null-ish
     *  → empty), matching the caller's original best-effort read. */
    listPublicEnabledProjectIdsInGroup(groupId: string): Promise<string[]>

    // ─── authz reads (used by modules/access) ────────────────────────────────
    // The "which teams / which role / which projects" reads the access module's
    // AccessService orchestrates. Teams owns these tables, so the queries live
    // here rather than in the access module.

    /** The caller's teams (each with their own role), personal team first then by
     *  name — the shape the top-bar selector and the active-team resolver consume.
     *  THROWS RepositoryError on a query failure. */
    listUserTeams(userId: string): Promise<TeamWithRole[]>

    /** The caller's role in a specific team, or null if they're not a member.
     *  FAIL-SAFE: a query error also folds to null (the guards that call this
     *  treat "no role" as no access, so a broken read fails closed). */
    findTeamRole(teamId: string, userId: string): Promise<TeamRole | null>

    /** Access-group ids the user belongs to within a team (raw; may repeat).
     *  Throws on failure. */
    listUserGroupIds(teamId: string, userId: string): Promise<string[]>

    /** Project ids granted to the given access groups (raw; may repeat). Throws
     *  on failure. */
    listProjectIdsForGroups(groupIds: string[]): Promise<string[]>

    /** Lazily create the caller's personal team (idempotent RPC) — a brand-new
     *  user has none and there is no auth.users trigger in this shared-auth setup.
     *  THROWS RepositoryError on failure. */
    ensurePersonalTeam(userId: string, name: string | null): Promise<void>

    /** The (team, creator) of a Collection (project_groups) row — the ownership
     *  pair the app-layer creator-or-admin gate reads. project_groups is part of
     *  the 0052 teams/collab schema slice, so the read lives here (a dedicated
     *  Collections module is a future carve). FAIL-SAFE: null when absent or on a
     *  query error, matching the guard's original best-effort inline read. */
    findCollectionOwnership(collectionId: string): Promise<{ team_id: string; user_id: string } | null>

    // ─── member administration (the management roster) ───────────────────────

    /** Every member of a team with role + join time, for the management roster.
     *  THROWS RepositoryError on failure. */
    listDetailed(teamId: string): Promise<TeamMemberDetail[]>

    /** Change a member's role. "last_owner" when the last-owner trigger blocked it
     *  (23514); throws RepositoryError on any other failure. */
    updateMemberRole(teamId: string, userId: string, role: TeamRole): Promise<MemberWriteResult>

    /** Remove a member (or a self-leave). "last_owner" when the trigger blocked
     *  removing the final owner (23514); throws on any other failure. */
    removeMember(teamId: string, userId: string): Promise<MemberWriteResult>
}
