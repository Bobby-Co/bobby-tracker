// Issues module — Supabase adapter for IssuesRepository. Infrastructure layer:
// the only place that touches the DB client for tracker.issues. A missing row
// resolves to null; a genuine query failure is thrown as RepositoryError.

import type { SupabaseClient } from "@supabase/supabase-js"
import { RepositoryError } from "@/lib/shared/kernel"
import type { Issue, IssueSuggestion } from "@/lib/shared/types"
import type {
    IssuesRepository,
    IssueSuggestContext,
    IssueDuplicateGuardRow,
    IssuePatch,
    IssueSimilarityState,
    NewIssue,
    NewIssueSuggestion,
    SimilarIssue,
} from "../ports/IssuesRepository"

// The suggest / fix-prompt projection — kept in one place so the port type and
// the select string can't drift apart.
const SUGGEST_CONTEXT_COLS =
    "id,project_id,issue_number,title,body,status,priority,labels,analyse_effort,created_at,updated_at"

// The RLS client and the service-role client carry different schema generics;
// accept any so both are assignable (mirrors the analyser repository).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any, any, any>

/** The Supabase adapter for IssuesRepository, bound to a specific client (RLS or
 *  service-role). Construct via the factory below. */
export class SupabaseIssuesRepository implements IssuesRepository {
    constructor(private readonly db: AnyDb) {}

    async findProjectId(issueId: string): Promise<string | null> {
        const { data, error } = await this.db
            .from("issues")
            .select("project_id")
            .eq("id", issueId)
            .maybeSingle<{ project_id: string }>()
        if (error) throw new RepositoryError(`issues project_id lookup failed: ${error.message}`, { cause: error })
        return data?.project_id ?? null
    }

    async findById(issueId: string): Promise<Issue | null> {
        const { data, error } = await this.db.from("issues").select("*").eq("id", issueId).maybeSingle<Issue>()
        if (error) throw new RepositoryError(`issues lookup failed: ${error.message}`, { cause: error })
        return data ?? null
    }

    async findByIdInProject(issueId: string, projectId?: string | null): Promise<Issue | null> {
        let query = this.db.from("issues").select("*").eq("id", issueId)
        if (projectId) query = query.eq("project_id", projectId)
        const { data, error } = await query.maybeSingle<Issue>()
        if (error) throw new RepositoryError(`issues lookup failed: ${error.message}`, { cause: error })
        return data ?? null
    }

    async findSuggestContext(issueId: string): Promise<IssueSuggestContext | null> {
        const { data, error } = await this.db
            .from("issues")
            .select(SUGGEST_CONTEXT_COLS)
            .eq("id", issueId)
            .maybeSingle<IssueSuggestContext>()
        if (error) throw new RepositoryError(`issue suggest-context lookup failed: ${error.message}`, { cause: error })
        return data ?? null
    }

    async findDuplicateGuardRows(ids: string[]): Promise<IssueDuplicateGuardRow[]> {
        const { data, error } = await this.db
            .from("issues")
            .select("id,project_id,duplicate_of_issue_id")
            .in("id", ids)
            .returns<IssueDuplicateGuardRow[]>()
        if (error) throw new RepositoryError(`issues duplicate-guard lookup failed: ${error.message}`, { cause: error })
        return data ?? []
    }

    async create(issue: NewIssue): Promise<Issue> {
        const { data, error } = await this.db.from("issues").insert(issue).select("*").single<Issue>()
        if (error) throw new RepositoryError(`issues insert failed: ${error.message}`, { cause: error })
        return data
    }

    async update(issueId: string, patch: IssuePatch): Promise<Issue> {
        const { data, error } = await this.db
            .from("issues")
            .update(patch)
            .eq("id", issueId)
            .select("*")
            .single<Issue>()
        if (error) throw new RepositoryError(`issues update failed: ${error.message}`, { cause: error })
        return data
    }

    async deleteById(issueId: string): Promise<void> {
        const { error } = await this.db.from("issues").delete().eq("id", issueId)
        if (error) throw new RepositoryError(`issues delete failed: ${error.message}`, { cause: error })
    }

    async findLatestSuggestion(issueId: string): Promise<IssueSuggestion | null> {
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

    async insertSuggestion(row: NewIssueSuggestion): Promise<IssueSuggestion> {
        const { data, error } = await this.db
            .from("issue_suggestions")
            .insert(row)
            .select("*")
            .single<IssueSuggestion>()
        if (error) throw new RepositoryError(`issue_suggestions insert failed: ${error.message}`, { cause: error })
        return data
    }

    async findSimilarityState(issueId: string, limit: number): Promise<IssueSimilarityState> {
        const [{ data: similar, error: rpcErr }, { data: emb, error: embErr }, { data: issue, error: issueErr }] =
            await Promise.all([
                this.db.rpc("find_similar_to_issue", { p_issue_id: issueId, p_limit: limit }),
                this.db.from("issue_embeddings").select("issue_id").eq("issue_id", issueId).maybeSingle<{ issue_id: string }>(),
                this.db.from("issues").select("created_at").eq("id", issueId).maybeSingle<{ created_at: string }>(),
            ])
        const err = rpcErr ?? embErr ?? issueErr
        if (err) throw new RepositoryError(`issue similarity lookup failed: ${err.message}`, { cause: err })
        return {
            similar: (similar ?? []) as SimilarIssue[],
            hasEmbedding: !!emb,
            createdAt: issue?.created_at ?? null,
        }
    }

    async listAcrossProjects(projectIds: string[], limit: number): Promise<Issue[]> {
        // Best-effort ([] on error), matching the collection feed's inline read.
        if (projectIds.length === 0) return []
        const { data } = await this.db
            .from("issues")
            .select("*")
            .in("project_id", projectIds)
            .order("updated_at", { ascending: false })
            .limit(limit)
            .returns<Issue[]>()
        return data ?? []
    }
}

/** Composition seam: bind an IssuesRepository to a specific Supabase client. Pass
 *  the request's RLS-scoped client so reads honour the caller's access; pass a
 *  service-role client only from a trusted context. */
export function createSupabaseIssuesRepository(db: AnyDb): IssuesRepository {
    return new SupabaseIssuesRepository(db)
}
