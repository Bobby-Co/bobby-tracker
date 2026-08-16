// Issues module — Supabase adapter for IssueSuggestionsRepository. Infrastructure
// layer: the only place that touches the DB client. See the port for why this is
// separate from SupabaseIssuesRepository.

import type { SupabaseClient } from "@supabase/supabase-js"
import { RepositoryError } from "@/lib/shared/kernel"
import type { IssueSuggestion } from "@/lib/shared/types"
import type { IssueSuggestionsRepository, NewIssueSuggestion } from "../ports/IssueSuggestionsRepository"

// The RLS client and the service-role client carry different schema generics;
// accept any schema so both are assignable.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any, any, any>

export class SupabaseIssueSuggestionsRepository implements IssueSuggestionsRepository {
    constructor(private readonly db: AnyDb) {}

    async findLatest(issueId: string): Promise<IssueSuggestion | null> {
        const { data, error } = await this.db
            .from("issue_suggestions")
            .select("*")
            .eq("issue_id", issueId)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle<IssueSuggestion>()
        if (error) throw new RepositoryError(`issue_suggestions lookup failed: ${error.message}`, { cause: error })
        return data ?? null
    }

    async insert(row: NewIssueSuggestion): Promise<IssueSuggestion> {
        const { data, error } = await this.db
            .from("issue_suggestions")
            .insert(row)
            .select("*")
            .single<IssueSuggestion>()
        if (error) throw new RepositoryError(`issue_suggestions insert failed: ${error.message}`, { cause: error })
        return data
    }

    async deleteForIssues(issueIds: string[]): Promise<void> {
        // An empty `in()` is a query that matches nothing but still round-trips;
        // more importantly it reads as "delete where issue_id in ()", which is
        // the kind of statement worth never generating at all.
        if (issueIds.length === 0) return
        const { error } = await this.db.from("issue_suggestions").delete().in("issue_id", issueIds)
        if (error) throw new RepositoryError(`issue_suggestions delete failed: ${error.message}`, { cause: error })
    }
}

/** Composition seam — callers depend on the port, never on this class. */
export function createSupabaseIssueSuggestionsRepository(db: AnyDb): IssueSuggestionsRepository {
    return new SupabaseIssueSuggestionsRepository(db)
}
