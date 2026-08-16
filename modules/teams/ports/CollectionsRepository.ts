// Teams module — "Collections" persistence PORT (project_groups + its
// project_group_members link table). Collections are groups of PROJECTS for AI
// routing — distinct from access_groups (people-groups). Part of the 0052 collab
// schema slice, so it lives in the teams module (a dedicated Collections module is
// a future carve). RLS scopes everything to the caller/team.

import type { ProjectGroup } from "@/lib/shared/types"

/** A project member of a collection, flattened from the PostgREST embed, with the
 *  analyser fields the routing/settings UIs derive readiness + has-summary from. */
export interface CollectionMember {
    id: string
    name: string
    status: string | null
    enabled: boolean | null
    graph_id: string | null
    has_summary: boolean
}

/** A member project's name keyed by its collection (for the list view's pills). */
export interface CollectionMemberName {
    group_id: string
    name: string
}

/** The mutable fields of a collection. */
export interface CollectionPatch {
    name?: string
    description?: string | null
}

/** Add-member outcome: "ok", or "duplicate" when the project is already in the
 *  group (23505) — the route maps that to a 409. */
export type CollectionMemberResult = "ok" | "duplicate"

export interface CollectionsRepository {
    /** The team's collections, newest first. THROWS RepositoryError. */
    listForTeam(teamId: string): Promise<ProjectGroup[]>

    /** id+name of every collection the caller can see, alphabetical — the session
     *  "source group" picker. FAIL-SAFE ([] on error). */
    listNames(teamId: string): Promise<{ id: string; name: string }[]>

    /** Member project names for the given collections. FAIL-SAFE ([] on error). */
    listMemberNames(groupIds: string[]): Promise<CollectionMemberName[]>

    /** A collection by id, or null when absent. THROWS on a query failure. */
    findById(id: string): Promise<ProjectGroup | null>

    /** A collection's id+name, or null when absent. THROWS on a query failure
     *  (callers that want fail-safe fold it with tryOrNull). */
    findSummary(id: string): Promise<Pick<ProjectGroup, "id" | "name"> | null>

    /** A collection's member projects with analyser state. FAIL-SAFE ([] on error). */
    listMembers(groupId: string): Promise<CollectionMember[]>

    /** Create a collection; returns the row. THROWS RepositoryError. */
    create(teamId: string, userId: string, name: string, description: string | null): Promise<ProjectGroup>

    /** Bulk-add member projects (initial membership on create). THROWS. */
    addMembers(groupId: string, projectIds: string[]): Promise<void>

    /** Rename / re-describe a collection; returns the row. THROWS. */
    update(id: string, patch: CollectionPatch): Promise<ProjectGroup>

    /** Delete a collection. THROWS. */
    delete(id: string): Promise<void>

    /** Add one project to a collection. "duplicate" when it's already a member
     *  (23505); throws on any other failure. */
    addMember(groupId: string, projectId: string): Promise<CollectionMemberResult>

    /** Remove one project from a collection. THROWS on failure. */
    removeMember(groupId: string, projectId: string): Promise<void>
}
