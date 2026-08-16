// Public infrastructure — the Supabase adapter for PublicSessionAdminRepository.
// The only place that writes public_sessions / public_session_invites /
// public_session_projects on the OWNER side, and reads the eligible-projects set.
// Bound to the caller's RLS-scoped client (owner-only policies do the authz).

import type { SupabaseClient } from "@supabase/supabase-js"
import { RepositoryError } from "@/lib/shared/kernel"
import type { PublicSession, PublicSessionInvite } from "@/lib/shared/types"
import type {
    NewPublicSession,
    PublicSessionAdminRepository,
    PublicSessionPatch,
    SessionProjectResult,
} from "../ports/PublicSessionAdminRepository"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any, any, any>

function unwrapName(v: unknown): string {
    const proj = Array.isArray(v) ? v[0] : v
    return proj && typeof proj === "object" && "name" in proj ? (proj as { name: string }).name : ""
}

export class SupabasePublicSessionAdminRepository implements PublicSessionAdminRepository {
    constructor(private readonly db: AnyDb) {}

    async listForTeam(teamId: string): Promise<PublicSession[]> {
        const { data, error } = await this.db
            .from("public_sessions")
            .select("*")
            .eq("team_id", teamId)
            .order("updated_at", { ascending: false })
            .returns<PublicSession[]>()
        if (error) throw new RepositoryError(error.message, { cause: error })
        return data ?? []
    }


    async findById(id: string): Promise<PublicSession | null> {
        const { data, error } = await this.db.from("public_sessions").select("*").eq("id", id).maybeSingle<PublicSession>()
        if (error) throw new RepositoryError(error.message, { cause: error })
        return data ?? null
    }

    async create(input: NewPublicSession): Promise<PublicSession> {
        const { data, error } = await this.db
            .from("public_sessions")
            .insert({
                team_id: input.teamId,
                user_id: input.userId,
                token: input.token,
                enabled: true,
                access_mode: input.accessMode,
                submissions_visibility: input.submissionsVisibility,
                group_id: input.groupId,
                name: input.name,
                title: input.title,
                description: input.description,
                start_at: input.startAt,
                end_at: input.endAt,
            })
            .select("*")
            .single<PublicSession>()
        if (error) throw new RepositoryError(error.message, { cause: error })
        return data
    }

    async update(id: string, patch: PublicSessionPatch): Promise<PublicSession> {
        const { data, error } = await this.db.from("public_sessions").update(patch).eq("id", id).select("*").single<PublicSession>()
        if (error) throw new RepositoryError(error.message, { cause: error })
        return data
    }

    async delete(id: string): Promise<void> {
        const { error } = await this.db.from("public_sessions").delete().eq("id", id)
        if (error) throw new RepositoryError(error.message, { cause: error })
    }

    async rotateToken(id: string, token: string): Promise<PublicSession> {
        const { data, error } = await this.db.from("public_sessions").update({ token }).eq("id", id).select("*").single<PublicSession>()
        if (error) throw new RepositoryError(error.message, { cause: error })
        return data
    }

    async listProjectNames(sessionId: string): Promise<{ id: string; name: string }[]> {
        const { data } = await this.db
            .from("public_session_projects")
            .select("project_id,projects(name)")
            .eq("session_id", sessionId)
        const rows = (data ?? []) as { project_id: string; projects: unknown }[]
        return rows.map((r) => ({ id: r.project_id, name: unwrapName(r.projects) }))
    }

    async listProjectNamesBySessions(sessionIds: string[]): Promise<{ session_id: string; name: string }[]> {
        if (sessionIds.length === 0) return []
        const { data } = await this.db
            .from("public_session_projects")
            .select("session_id,project_id,projects(name)")
            .in("session_id", sessionIds)
        const rows = (data ?? []) as { session_id: string; projects: unknown }[]
        const out: { session_id: string; name: string }[] = []
        for (const r of rows) {
            const name = unwrapName(r.projects)
            if (name) out.push({ session_id: r.session_id, name })
        }
        return out
    }

    async addProject(sessionId: string, projectId: string): Promise<SessionProjectResult> {
        const { error } = await this.db.from("public_session_projects").insert({ session_id: sessionId, project_id: projectId })
        if (error) {
            if (error.code === "23505") return "duplicate"
            if (error.code === "23514") return "integration_disabled"
            throw new RepositoryError(error.message, { cause: error })
        }
        return "ok"
    }

    async addProjects(sessionId: string, projectIds: string[]): Promise<"ok" | "integration_disabled"> {
        if (projectIds.length === 0) return "ok"
        const { error } = await this.db
            .from("public_session_projects")
            .insert(projectIds.map((project_id) => ({ session_id: sessionId, project_id })))
        if (error) {
            if (error.code === "23514") return "integration_disabled"
            throw new RepositoryError(error.message, { cause: error })
        }
        return "ok"
    }

    async removeProject(sessionId: string, projectId: string): Promise<void> {
        const { error } = await this.db
            .from("public_session_projects")
            .delete()
            .eq("session_id", sessionId)
            .eq("project_id", projectId)
        if (error) throw new RepositoryError(error.message, { cause: error })
    }

    async removeProjectFromAllSessions(projectId: string): Promise<void> {
        const { error } = await this.db.from("public_session_projects").delete().eq("project_id", projectId)
        if (error) throw new RepositoryError(error.message, { cause: error })
    }

    async listInvites(sessionId: string): Promise<PublicSessionInvite[]> {
        const { data, error } = await this.db
            .from("public_session_invites")
            .select("session_id,email,created_at")
            .eq("session_id", sessionId)
            .order("created_at", { ascending: true })
            .returns<PublicSessionInvite[]>()
        if (error) throw new RepositoryError(error.message, { cause: error })
        return data ?? []
    }

    async addInvites(sessionId: string, emails: string[]): Promise<PublicSessionInvite[]> {
        const { data, error } = await this.db
            .from("public_session_invites")
            .upsert(
                emails.map((email) => ({ session_id: sessionId, email })),
                { onConflict: "session_id,email", ignoreDuplicates: true },
            )
            .select("session_id,email,created_at")
            .returns<PublicSessionInvite[]>()
        if (error) throw new RepositoryError(error.message, { cause: error })
        return data ?? []
    }

    async addOwnerInvite(sessionId: string, email: string): Promise<void> {
        // Best-effort — the route fires this without awaiting the outcome.
        await this.db
            .from("public_session_invites")
            .upsert({ session_id: sessionId, email }, { onConflict: "session_id,email", ignoreDuplicates: true })
    }

    async removeInvite(sessionId: string, email: string): Promise<void> {
        const { error } = await this.db.from("public_session_invites").delete().eq("session_id", sessionId).eq("email", email)
        if (error) throw new RepositoryError(error.message, { cause: error })
    }

    async listEligibleProjects(teamId: string): Promise<{ id: string; name: string }[]> {
        const { data } = await this.db
            .from("projects")
            .select("id,name,project_public_integration!inner(enabled)")
            .eq("team_id", teamId)
            .eq("project_public_integration.enabled", true)
            .order("name", { ascending: true })
        return ((data as unknown as { id: string; name: string }[]) ?? []).map((p) => ({ id: p.id, name: p.name }))
    }
}

/** Composition seam: bind a PublicSessionAdminRepository to a specific client. */
export function createSupabasePublicSessionAdminRepository(db: AnyDb): PublicSessionAdminRepository {
    return new SupabasePublicSessionAdminRepository(db)
}
