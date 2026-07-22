// Public infrastructure — the Supabase PublicSessionRepository adapter. The ONLY
// place that touches the public_sessions / public_session_projects /
// public_issue_reporters / public_session_invites tables. Swapping persistence
// means replacing this file; the service that depends on the port is unchanged.
//
// Null-on-miss/error semantics (matches the original resolver, which ignored
// query errors and folded them to a not-found): a missing row — or a failed
// read — resolves to null / [] / false.

import type { SupabaseClient } from "@supabase/supabase-js"
import type { IssueReporter, PublicSessionRepository, PublicSessionRow } from "../ports/PublicSessionRepository"

// The RLS client and the service-role client carry different schema generics;
// accept any schema so both are assignable (mirrors the other repositories).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any, any, any>

export class SupabasePublicSessionRepository implements PublicSessionRepository {
    constructor(private readonly db: AnyDb) {}

    async findByToken(token: string): Promise<PublicSessionRow | null> {
        const { data } = await this.db
            .from("public_sessions")
            .select("id,enabled,access_mode,submissions_visibility,start_at,end_at,group_id")
            .eq("token", token)
            .maybeSingle<PublicSessionRow>()
        return data ?? null
    }

    async listManualProjectIds(sessionId: string): Promise<string[]> {
        const { data } = await this.db
            .from("public_session_projects")
            .select("project_id")
            .eq("session_id", sessionId)
            .returns<{ project_id: string }[]>()
        return (data ?? []).map((r) => r.project_id)
    }

    async findIssueReporter(issueId: string): Promise<IssueReporter | null> {
        const { data } = await this.db
            .from("public_issue_reporters")
            .select("reporter_id,auth_user_id")
            .eq("issue_id", issueId)
            .maybeSingle<IssueReporter>()
        return data ?? null
    }

    async hasInvite(sessionId: string, email: string): Promise<boolean> {
        const { data } = await this.db
            .from("public_session_invites")
            .select("email")
            .eq("session_id", sessionId)
            .eq("email", email)
            .maybeSingle<{ email: string }>()
        return data != null
    }

    async findOwnership(sessionId: string): Promise<{ team_id: string; user_id: string } | null> {
        const { data } = await this.db
            .from("public_sessions")
            .select("team_id,user_id")
            .eq("id", sessionId)
            .maybeSingle<{ team_id: string; user_id: string }>()
        return data ?? null
    }
}

/** Composition seam: bind a PublicSessionRepository to a specific Supabase client. */
export function createSupabasePublicSessionRepository(db: AnyDb): PublicSessionRepository {
    return new SupabasePublicSessionRepository(db)
}
