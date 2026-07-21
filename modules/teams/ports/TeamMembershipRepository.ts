// Teams module — membership/access-control repository PORT. The team, access
// group, and collection (project-group) tables are Teams-owned; other contexts
// (e.g. notification fan-out, public-session resolution) read them ONLY through
// this contract instead of querying the tables directly.
//
// ports/ may reference a shared row type, but here the shapes are small and
// local. Concrete persistence lives in ../infrastructure.

export interface TeamMember {
    user_id: string
    role: "owner" | "admin" | "member"
}

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
}
