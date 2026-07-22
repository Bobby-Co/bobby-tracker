// Access module — the AccessService. The application layer of the authorization
// context: the "rich logic" half of the HYBRID design (migration 0052). RLS at
// the database is only a COARSE tenant backstop ("you may touch a row iff you're
// a member of its team"); this service is where the finer rules are orchestrated:
//
//   • which team a request is acting in (the active team),
//   • a member's role (owner / admin / member),
//   • the set of projects a member may actually see (owner/admin ⇒ all team
//     projects; member ⇒ only projects granted to a group they belong to),
//   • whether the caller may touch one specific project.
//
// It owns NO tables — it is a policy over the Teams and Projects repositories,
// both injected as ports. Pure application code: no framework, no SDK, no DB row
// types (the team vocabulary comes through the Teams contract). This replaces the
// loose functions that used to live in lib/auth/team-access.ts.

import type { ProjectsRepository } from "@/modules/projects"
import type { TeamMembershipRepository, TeamWithRole } from "@/modules/teams"
import { Role } from "../domain/Role"
import type { TeamRoleValue } from "../domain/Role"
import { AccessPolicy } from "../domain/AccessPolicy"

/** The outcome of a single-project access check: whether the caller may touch it,
 *  and the resolved team/role context callers reuse for further role gates. */
export interface ProjectAccess {
    ok: boolean
    teamId: string | null
    role: TeamRoleValue | null
}

export class AccessService {
    private readonly policy = new AccessPolicy()

    constructor(
        private readonly projects: ProjectsRepository,
        private readonly teams: TeamMembershipRepository,
    ) {}

    /** The caller's teams (each with their role), personal team first. Bootstraps
     *  a personal team on first use — a brand-new user has none yet. */
    async listTeams(userId: string, personalName?: string): Promise<TeamWithRole[]> {
        const teams = await this.teams.listUserTeams(userId)
        if (teams.length > 0) return teams
        await this.teams.ensurePersonalTeam(userId, personalName ?? null)
        return this.teams.listUserTeams(userId)
    }

    /** Resolve which team a request acts in. `requested` is the x-team-id
     *  header/cookie value (may be null / stale); it's honoured only if the caller
     *  is actually a member. Falls back to the personal team, then the first team.
     *  Returns null only if the user somehow has no team even after bootstrap. */
    async resolveActiveTeam(
        userId: string,
        requested: string | null,
        personalName?: string,
    ): Promise<TeamWithRole | null> {
        const teams = await this.listTeams(userId, personalName)
        if (teams.length === 0) return null
        if (requested) {
            const hit = teams.find((t) => t.id === requested)
            if (hit) return hit
        }
        return teams.find((t) => t.is_personal) ?? teams[0]
    }

    /** The caller's role in a specific team, or null if they're not a member. */
    async teamRole(teamId: string, userId: string): Promise<TeamRoleValue | null> {
        return this.teams.findTeamRole(teamId, userId)
    }

    /** The projects a caller may access inside a team.
     *   - owner/admin ⇒ "all" (every project the team owns)
     *   - member      ⇒ the distinct set of projects granted to a group they're in
     *  A member in no group returns [] (sees nothing). */
    async accessibleProjectIds(
        teamId: string,
        userId: string,
        role: TeamRoleValue,
    ): Promise<"all" | string[]> {
        const r = Role.of(role)
        // Admins/owners see everything — no need to read the group tables.
        if (r.atLeast("admin")) return "all"
        const groupIds = await this.teams.listUserGroupIds(teamId, userId)
        if (groupIds.length === 0) return []
        const projectIds = await this.teams.listProjectIdsForGroups(groupIds)
        return this.policy.scopeForRole(r, projectIds)
    }

    /** Whether the caller may access a specific project, and the team/role context.
     *  Coarse RLS lets any team member READ the project row; this adds the
     *  group-level check the DB deliberately doesn't (a plain member must have the
     *  project granted to one of their groups). Guards /api/projects/[id]/* and the
     *  issue item routes. */
    async canAccessProject(userId: string, projectId: string): Promise<ProjectAccess> {
        const teamId = await this.projects.findTeamId(projectId)
        if (!teamId) return { ok: false, teamId: null, role: null } // not a team member, or missing

        const role = await this.teams.findTeamRole(teamId, userId)
        if (!role) return { ok: false, teamId, role: null }

        const scope = await this.accessibleProjectIds(teamId, userId, role)
        return { ok: this.policy.allows(scope, projectId), teamId, role }
    }
}
