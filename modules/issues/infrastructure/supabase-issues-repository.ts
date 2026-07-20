// Issues module — Supabase adapter for IssuesRepository. Infrastructure layer:
// the only place that touches the DB client for tracker.issues. A missing row
// resolves to null; a genuine query failure is thrown as RepositoryError.

import type { SupabaseClient } from "@supabase/supabase-js"
import { RepositoryError } from "@/lib/kernel"
import type { Issue } from "@/lib/supabase/types"
import type { IssuesRepository } from "../ports/issues-repository"

// The RLS client and the service-role client carry different schema generics;
// accept any so both are assignable (mirrors the analyser repository).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any, any, any>

/** Build an IssuesRepository bound to a specific Supabase client. Pass the
 *  request's RLS-scoped client so reads honour the caller's access; pass a
 *  service-role client only from a trusted context. */
export function createSupabaseIssuesRepository(db: AnyDb): IssuesRepository {
    return {
        async findProjectId(issueId) {
            const { data, error } = await db
                .from("issues")
                .select("project_id")
                .eq("id", issueId)
                .maybeSingle<{ project_id: string }>()
            if (error) throw new RepositoryError(`issues project_id lookup failed: ${error.message}`, { cause: error })
            return data?.project_id ?? null
        },
        async findById(issueId) {
            const { data, error } = await db
                .from("issues")
                .select("*")
                .eq("id", issueId)
                .maybeSingle<Issue>()
            if (error) throw new RepositoryError(`issues lookup failed: ${error.message}`, { cause: error })
            return data ?? null
        },
        async deleteById(issueId) {
            const { error } = await db.from("issues").delete().eq("id", issueId)
            if (error) throw new RepositoryError(`issues delete failed: ${error.message}`, { cause: error })
        },
    }
}
