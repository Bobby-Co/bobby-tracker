// Teams module — Supabase adapter for TeamMembershipRepository. Infrastructure:
// the only place that queries the team_members / access_group_* / project_group
// tables. Queries reproduce the previous inline reads verbatim.

import type { SupabaseClient } from "@supabase/supabase-js"
import { RepositoryError } from "@/lib/kernel"
import type { TeamMember, TeamMembershipRepository } from "../ports/team-membership-repository"

// The RLS client and the service-role client carry different schema generics
// ("public" vs "tracker"); accept any schema so both are assignable.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any, any, any>

export function createSupabaseTeamMembershipRepository(db: AnyDb): TeamMembershipRepository {
    return {
        async listTeamMembers(teamId) {
            const { data, error } = await db.from("team_members").select("user_id,role").eq("team_id", teamId)
            if (error) throw new RepositoryError(error.message, { cause: error })
            return (data ?? []) as TeamMember[]
        },

        async listGroupIdsForProject(projectId) {
            const { data, error } = await db.from("access_group_projects").select("group_id").eq("project_id", projectId)
            if (error) throw new RepositoryError(error.message, { cause: error })
            return ((data ?? []) as { group_id: string }[]).map((r) => r.group_id)
        },

        async listGroupMemberUserIds(teamId, groupIds) {
            const { data, error } = await db
                .from("access_group_members")
                .select("user_id")
                .in("group_id", groupIds)
                .eq("team_id", teamId)
            if (error) throw new RepositoryError(error.message, { cause: error })
            return ((data ?? []) as { user_id: string }[]).map((r) => r.user_id)
        },

        async listPublicEnabledProjectIdsInGroup(groupId) {
            const { data } = await db
                .from("project_group_members")
                .select("project_id,projects!inner(project_public_integration!inner(enabled))")
                .eq("group_id", groupId)
                .eq("projects.project_public_integration.enabled", true)
                .returns<{ project_id: string }[]>()
            return (data ?? []).map((r) => r.project_id)
        },
    }
}
