// Teams infrastructure — the Supabase adapter for AccessGroupsRepository. The only
// place that queries the access_groups / access_group_members / access_group_projects
// tables. Bound to the caller's RLS-scoped client.

import type { SupabaseClient } from "@supabase/supabase-js"
import { RepositoryError } from "@/lib/shared/kernel"
import type { AccessGroup } from "@/lib/shared/types"
import type {
    AccessGroupMemberLink,
    AccessGroupPatch,
    AccessGroupProjectLink,
    AccessGroupsRepository,
    LinkWriteResult,
} from "../ports/AccessGroupsRepository"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any, any, any>

export class SupabaseAccessGroupsRepository implements AccessGroupsRepository {
    constructor(private readonly db: AnyDb) {}

    async listForTeam(teamId: string): Promise<AccessGroup[]> {
        const { data, error } = await this.db.from("access_groups").select("*").eq("team_id", teamId).order("name")
        if (error) throw new RepositoryError(error.message, { cause: error })
        return (data ?? []) as AccessGroup[]
    }

    async listMembers(groupIds: string[]): Promise<AccessGroupMemberLink[]> {
        // Best-effort ([] on error), matching the roster route's ignored-error read.
        const { data } = await this.db.from("access_group_members").select("group_id, user_id").in("group_id", groupIds)
        return (data ?? []) as AccessGroupMemberLink[]
    }

    async listProjectGrants(groupIds: string[]): Promise<AccessGroupProjectLink[]> {
        const { data } = await this.db.from("access_group_projects").select("group_id, project_id").in("group_id", groupIds)
        return (data ?? []) as AccessGroupProjectLink[]
    }

    async create(teamId: string, name: string, description: string | null, createdBy: string): Promise<AccessGroup> {
        const { data, error } = await this.db
            .from("access_groups")
            .insert({ team_id: teamId, name, description, created_by: createdBy })
            .select("*")
            .single<AccessGroup>()
        if (error) throw new RepositoryError(error.message, { cause: error })
        return data
    }

    async update(groupId: string, teamId: string, patch: AccessGroupPatch): Promise<AccessGroup> {
        const { data, error } = await this.db
            .from("access_groups")
            .update(patch)
            .eq("id", groupId)
            .eq("team_id", teamId)
            .select("*")
            .single<AccessGroup>()
        if (error) throw new RepositoryError(error.message, { cause: error })
        return data
    }

    async delete(groupId: string, teamId: string): Promise<void> {
        const { error } = await this.db.from("access_groups").delete().eq("id", groupId).eq("team_id", teamId)
        if (error) throw new RepositoryError(error.message, { cause: error })
    }

    async addMember(groupId: string, teamId: string, userId: string): Promise<LinkWriteResult> {
        const { error } = await this.db
            .from("access_group_members")
            .upsert({ group_id: groupId, team_id: teamId, user_id: userId }, { onConflict: "group_id,user_id" })
        if (error) {
            if (error.code === "23503") return "fk_violation" // user not on the team
            throw new RepositoryError(error.message, { cause: error })
        }
        return "ok"
    }

    async removeMember(groupId: string, userId: string): Promise<void> {
        const { error } = await this.db.from("access_group_members").delete().eq("group_id", groupId).eq("user_id", userId)
        if (error) throw new RepositoryError(error.message, { cause: error })
    }

    async grantProject(groupId: string, teamId: string, projectId: string): Promise<LinkWriteResult> {
        const { error } = await this.db
            .from("access_group_projects")
            .upsert({ group_id: groupId, team_id: teamId, project_id: projectId }, { onConflict: "group_id,project_id" })
        if (error) {
            if (error.code === "23503") return "fk_violation" // project from another team
            throw new RepositoryError(error.message, { cause: error })
        }
        return "ok"
    }

    async revokeProject(groupId: string, projectId: string): Promise<void> {
        const { error } = await this.db.from("access_group_projects").delete().eq("group_id", groupId).eq("project_id", projectId)
        if (error) throw new RepositoryError(error.message, { cause: error })
    }
}

/** Composition seam: bind an AccessGroupsRepository to a specific Supabase client. */
export function createSupabaseAccessGroupsRepository(db: AnyDb): AccessGroupsRepository {
    return new SupabaseAccessGroupsRepository(db)
}
