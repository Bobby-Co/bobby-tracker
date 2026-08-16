// Teams infrastructure — the Supabase adapter for CollectionsRepository. The only
// place that queries project_groups / project_group_members. Owns the PostgREST
// embed shapes (projects(...) / project_analyser(...)) and flattens them, so the
// routes see clean projections. Bound to the caller's RLS-scoped client.

import type { SupabaseClient } from "@supabase/supabase-js"
import { RepositoryError } from "@/lib/shared/kernel"
import type { ProjectGroup } from "@/lib/shared/types"
import type {
    CollectionMember,
    CollectionMemberName,
    CollectionMemberResult,
    CollectionPatch,
    CollectionsRepository,
} from "../ports/CollectionsRepository"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any, any, any>

// PostgREST returns a to-one embed as an object, or an array when it can't prove
// uniqueness — normalise both.
function unwrap<T>(v: T | T[] | null | undefined): T | null {
    return Array.isArray(v) ? v[0] ?? null : v ?? null
}

export class SupabaseCollectionsRepository implements CollectionsRepository {
    constructor(private readonly db: AnyDb) {}

    async listForTeam(teamId: string): Promise<ProjectGroup[]> {
        const { data, error } = await this.db
            .from("project_groups")
            .select("*")
            .eq("team_id", teamId)
            .order("updated_at", { ascending: false })
            .returns<ProjectGroup[]>()
        if (error) throw new RepositoryError(error.message, { cause: error })
        return data ?? []
    }

    async listNames(teamId: string): Promise<{ id: string; name: string }[]> {
        // Best-effort ([] on error), matching the session route's inline read.
        const { data } = await this.db
            .from("project_groups")
            .select("id,name")
            .eq("team_id", teamId)
            .order("name", { ascending: true })
            .returns<{ id: string; name: string }[]>()
        return (data ?? []).map((g) => ({ id: g.id, name: g.name }))
    }

    async listMemberNames(groupIds: string[]): Promise<CollectionMemberName[]> {
        if (groupIds.length === 0) return []
        const { data } = await this.db
            .from("project_group_members")
            .select("group_id,project_id,projects(name)")
            .in("group_id", groupIds)
        const rows = (data ?? []) as { group_id: string; projects: { name: string } | { name: string }[] | null }[]
        const out: CollectionMemberName[] = []
        for (const r of rows) {
            const proj = unwrap(r.projects)
            if (proj?.name) out.push({ group_id: r.group_id, name: proj.name })
        }
        return out
    }

    async findById(id: string): Promise<ProjectGroup | null> {
        const { data, error } = await this.db.from("project_groups").select("*").eq("id", id).maybeSingle<ProjectGroup>()
        if (error) throw new RepositoryError(error.message, { cause: error })
        return data ?? null
    }

    async findSummary(id: string): Promise<Pick<ProjectGroup, "id" | "name"> | null> {
        const { data, error } = await this.db
            .from("project_groups")
            .select("id,name")
            .eq("id", id)
            .maybeSingle<Pick<ProjectGroup, "id" | "name">>()
        if (error) throw new RepositoryError(error.message, { cause: error })
        return data ?? null
    }

    async listMembers(groupId: string): Promise<CollectionMember[]> {
        // Best-effort ([] on error), matching the routes' ignored-error reads.
        const { data } = await this.db
            .from("project_group_members")
            .select("project_id,projects(id,name,project_analyser(status,enabled,graph_id,summary_overview_embedding))")
            .eq("group_id", groupId)
        const rows = (data ?? []) as { projects: unknown }[]
        const out: CollectionMember[] = []
        for (const r of rows) {
            const proj = unwrap(r.projects as Record<string, unknown> | Record<string, unknown>[] | null)
            if (!proj || typeof proj !== "object") continue
            const p = proj as { id: string; name: string; project_analyser?: unknown }
            const a = unwrap(p.project_analyser as Record<string, unknown> | Record<string, unknown>[] | null)
            const analyser = a && typeof a === "object" ? (a as Record<string, unknown>) : null
            out.push({
                id: p.id,
                name: p.name,
                status: (analyser?.status as string | null) ?? null,
                enabled: (analyser?.enabled as boolean | null) ?? null,
                graph_id: (analyser?.graph_id as string | null) ?? null,
                has_summary: !!analyser && analyser.summary_overview_embedding != null,
            })
        }
        return out
    }

    async create(teamId: string, userId: string, name: string, description: string | null): Promise<ProjectGroup> {
        const { data, error } = await this.db
            .from("project_groups")
            .insert({ team_id: teamId, user_id: userId, name, description })
            .select("*")
            .single<ProjectGroup>()
        if (error) throw new RepositoryError(error.message, { cause: error })
        return data
    }

    async addMembers(groupId: string, projectIds: string[]): Promise<void> {
        if (projectIds.length === 0) return
        const { error } = await this.db
            .from("project_group_members")
            .insert(projectIds.map((project_id) => ({ group_id: groupId, project_id })))
        if (error) throw new RepositoryError(error.message, { cause: error })
    }

    async update(id: string, patch: CollectionPatch): Promise<ProjectGroup> {
        const { data, error } = await this.db.from("project_groups").update(patch).eq("id", id).select("*").single<ProjectGroup>()
        if (error) throw new RepositoryError(error.message, { cause: error })
        return data
    }

    async delete(id: string): Promise<void> {
        const { error } = await this.db.from("project_groups").delete().eq("id", id)
        if (error) throw new RepositoryError(error.message, { cause: error })
    }

    async addMember(groupId: string, projectId: string): Promise<CollectionMemberResult> {
        const { error } = await this.db.from("project_group_members").insert({ group_id: groupId, project_id: projectId })
        if (error) {
            if (error.code === "23505") return "duplicate" // already in the group
            throw new RepositoryError(error.message, { cause: error })
        }
        return "ok"
    }

    async removeMember(groupId: string, projectId: string): Promise<void> {
        const { error } = await this.db
            .from("project_group_members")
            .delete()
            .eq("group_id", groupId)
            .eq("project_id", projectId)
        if (error) throw new RepositoryError(error.message, { cause: error })
    }
}

/** Composition seam: bind a CollectionsRepository to a specific Supabase client. */
export function createSupabaseCollectionsRepository(db: AnyDb): CollectionsRepository {
    return new SupabaseCollectionsRepository(db)
}
