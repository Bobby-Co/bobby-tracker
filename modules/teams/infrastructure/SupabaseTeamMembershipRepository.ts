// Teams module — Supabase adapter for TeamMembershipRepository. Infrastructure:
// the only place that queries the team_members / access_group_* / project_group
// tables. Queries reproduce the previous inline reads verbatim.

import type { SupabaseClient } from "@supabase/supabase-js"
import { RepositoryError } from "@/lib/shared/kernel"
import type { Team, TeamRole, TeamWithRole } from "@/lib/shared/types"
import type { TeamMember, TeamMembershipRepository } from "../ports/TeamMembershipRepository"

// The RLS client and the service-role client carry different schema generics
// ("public" vs "tracker"); accept any schema so both are assignable.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any, any, any>

/** The Supabase adapter for TeamMembershipRepository, bound to a specific client.
 *  Construct via the factory below. */
export class SupabaseTeamMembershipRepository implements TeamMembershipRepository {
    constructor(private readonly db: AnyDb) {}

    async listTeamMembers(teamId: string): Promise<TeamMember[]> {
        const { data, error } = await this.db.from("team_members").select("user_id,role").eq("team_id", teamId)
        if (error) throw new RepositoryError(error.message, { cause: error })
        return (data ?? []) as TeamMember[]
    }

    async listGroupIdsForProject(projectId: string): Promise<string[]> {
        const { data, error } = await this.db.from("access_group_projects").select("group_id").eq("project_id", projectId)
        if (error) throw new RepositoryError(error.message, { cause: error })
        return ((data ?? []) as { group_id: string }[]).map((r) => r.group_id)
    }

    async listGroupMemberUserIds(teamId: string, groupIds: string[]): Promise<string[]> {
        const { data, error } = await this.db
            .from("access_group_members")
            .select("user_id")
            .in("group_id", groupIds)
            .eq("team_id", teamId)
        if (error) throw new RepositoryError(error.message, { cause: error })
        return ((data ?? []) as { user_id: string }[]).map((r) => r.user_id)
    }

    async listPublicEnabledProjectIdsInGroup(groupId: string): Promise<string[]> {
        const { data } = await this.db
            .from("project_group_members")
            .select("project_id,projects!inner(project_public_integration!inner(enabled))")
            .eq("group_id", groupId)
            .eq("projects.project_public_integration.enabled", true)
            .returns<{ project_id: string }[]>()
        return (data ?? []).map((r) => r.project_id)
    }

    // ─── authz reads (used by modules/access) ────────────────────────────────

    async listUserTeams(userId: string): Promise<TeamWithRole[]> {
        const { data, error } = await this.db
            .from("team_members")
            .select("role, teams(*)")
            .eq("user_id", userId)
        if (error) throw new RepositoryError(error.message, { cause: error })
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

    async findTeamRole(teamId: string, userId: string): Promise<TeamRole | null> {
        // Fail-safe by design: the original getTeamRole ignored the query error
        // and the guards treat a null role as "no access", so we keep that shape.
        const { data } = await this.db
            .from("team_members")
            .select("role")
            .eq("team_id", teamId)
            .eq("user_id", userId)
            .maybeSingle()
        return (data as { role: TeamRole } | null)?.role ?? null
    }

    async listUserGroupIds(teamId: string, userId: string): Promise<string[]> {
        const { data, error } = await this.db
            .from("access_group_members")
            .select("group_id")
            .eq("user_id", userId)
            .eq("team_id", teamId)
        if (error) throw new RepositoryError(error.message, { cause: error })
        return ((data ?? []) as { group_id: string }[]).map((r) => r.group_id)
    }

    async listProjectIdsForGroups(groupIds: string[]): Promise<string[]> {
        const { data, error } = await this.db
            .from("access_group_projects")
            .select("project_id")
            .in("group_id", groupIds)
        if (error) throw new RepositoryError(error.message, { cause: error })
        return ((data ?? []) as { project_id: string }[]).map((r) => r.project_id)
    }

    async ensurePersonalTeam(userId: string, name: string | null): Promise<void> {
        const { error } = await this.db.rpc("ensure_personal_team", { p_user: userId, p_name: name })
        if (error) throw new RepositoryError(`ensure_personal_team failed: ${error.message}`, { cause: error })
    }
}

/** Composition seam: bind a TeamMembershipRepository to a specific Supabase client. */
export function createSupabaseTeamMembershipRepository(db: AnyDb): TeamMembershipRepository {
    return new SupabaseTeamMembershipRepository(db)
}
