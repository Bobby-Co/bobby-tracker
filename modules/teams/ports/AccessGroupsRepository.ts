// Teams module — the access_groups persistence PORT (people-groups: the
// access_groups table + its membership and project-grant link tables). NOT
// project_groups / "Collections" (those are a separate surface). RLS scopes
// everything to the team; role gating is done in the route.

import type { AccessGroup } from "@/lib/shared/types"

export interface AccessGroupMemberLink {
    group_id: string
    user_id: string
}
export interface AccessGroupProjectLink {
    group_id: string
    project_id: string
}

/** The mutable fields of a people-group. */
export interface AccessGroupPatch {
    name?: string
    description?: string | null
}

/** Outcome of a link write: "ok", or "fk_violation" when the composite FK
 *  rejected the row (23503) — a member who isn't on the team, or a project from
 *  another team. The route maps that to a 400. */
export type LinkWriteResult = "ok" | "fk_violation"

export interface AccessGroupsRepository {
    /** The team's people-groups, ordered by name. THROWS RepositoryError. */
    listForTeam(teamId: string): Promise<AccessGroup[]>

    /** Member links for the given groups. FAIL-SAFE ([] on error) — the roster
     *  read is best-effort, matching the route's ignored-error inline read. */
    listMembers(groupIds: string[]): Promise<AccessGroupMemberLink[]>

    /** Project-grant links for the given groups. FAIL-SAFE ([] on error). */
    listProjectGrants(groupIds: string[]): Promise<AccessGroupProjectLink[]>

    /** Create a people-group; returns the row. THROWS RepositoryError. */
    create(teamId: string, name: string, description: string | null, createdBy: string): Promise<AccessGroup>

    /** Rename / re-describe a people-group; returns the row. THROWS. */
    update(groupId: string, teamId: string, patch: AccessGroupPatch): Promise<AccessGroup>

    /** Delete a people-group (its membership + grants cascade). THROWS. */
    delete(groupId: string, teamId: string): Promise<void>

    /** Add a team member to a group (idempotent upsert). "fk_violation" when the
     *  user isn't on the team (23503); throws on any other failure. */
    addMember(groupId: string, teamId: string, userId: string): Promise<LinkWriteResult>

    /** Remove a person from a group. THROWS on failure. */
    removeMember(groupId: string, userId: string): Promise<void>

    /** Grant a team project to a group (idempotent upsert). "fk_violation" when
     *  the project belongs to another team (23503); throws otherwise. */
    grantProject(groupId: string, teamId: string, projectId: string): Promise<LinkWriteResult>

    /** Revoke a project grant from a group. THROWS on failure. */
    revokeProject(groupId: string, projectId: string): Promise<void>
}
