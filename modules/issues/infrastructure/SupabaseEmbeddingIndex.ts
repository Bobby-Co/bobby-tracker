// Issues infrastructure — the Supabase EmbeddingIndex adapter. The ONLY place
// that touches issue_embeddings + the unembedded-issues query. Owns the
// partitioned-table detail; swapping persistence means replacing this file.
//
// Always bound to the SERVICE-ROLE client (see createServiceEmbeddingIndex):
//   1. The cookie-bound client may be torn down before a fire-and-forget embed
//      resolves.
//   2. Public submissions have no auth cookie at all (link mode).
// RLS isn't a concern — the route handler has already done the ownership/token
// checks before an embed is scheduled.

import type { SupabaseClient } from "@supabase/supabase-js"
import { RepositoryError } from "@/lib/kernel"
import { createServiceClient } from "@/lib/supabase/server"
import type { EmbeddingIndex, EmbeddingUpsert, UnembeddedIssue } from "../ports/EmbeddingIndex"

// The RLS client and the service-role client carry different schema generics;
// accept any schema so both are assignable (mirrors the other repositories).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any, any, any>

// tracker.issue_embeddings is PARTITIONED BY project_id (done for scale; the
// partitioned definition lives outside supabase/migrations, which still shows
// the older single-table shape from 0015 — don't trust that file for this
// table's real schema). Two consequences:
//   1. project_id is NOT NULL and is the partition key — a row without it has no
//      partition to land in and is rejected outright.
//   2. A unique constraint on a partitioned table must include every partition
//      key column, so the only one here is (project_id, issue_id); upserting on
//      issue_id alone fails 42P10. Always carry project_id, always conflict on both.
const CONFLICT_TARGET = "project_id,issue_id"

// PostgREST spelling of "issues with no embedding row": LEFT JOIN the embedding
// and keep the misses. `!left` forces the outer join; `is null` on the embedded
// resource filters on its absence.
const MISSING_EMBEDDING_SELECT = "id,project_id,title,body,issue_embeddings!left(issue_id)"

export class SupabaseEmbeddingIndex implements EmbeddingIndex {
    constructor(private readonly db: AnyDb) {}

    async upsert(row: EmbeddingUpsert): Promise<void> {
        const { error } = await this.db.from("issue_embeddings").upsert(
            { issue_id: row.issueId, project_id: row.projectId, embedding: row.vector, model: row.model },
            { onConflict: CONFLICT_TARGET },
        )
        if (error) throw new RepositoryError(`issue_embeddings upsert failed: ${error.message}`, { cause: error })
    }

    async findUnembedded(projectId: string, limit: number): Promise<UnembeddedIssue[]> {
        const { data, error } = await this.db
            .from("issues")
            .select(MISSING_EMBEDDING_SELECT)
            // Oldest first so a large import drains in a stable order rather than
            // re-picking a shifting window between sweeps.
            .order("created_at", { ascending: true })
            .eq("project_id", projectId)
            .is("issue_embeddings", null)
            .limit(limit)
            .returns<UnembeddedIssue[]>()
        if (error) throw new RepositoryError(`unembedded issues lookup failed: ${error.message}`, { cause: error })
        return data ?? []
    }

    async countUnembedded(projectId: string): Promise<number> {
        const { count, error } = await this.db
            .from("issues")
            .select(MISSING_EMBEDDING_SELECT, { count: "exact", head: true })
            .eq("project_id", projectId)
            .is("issue_embeddings", null)
        if (error) throw new RepositoryError(`unembedded issue count failed: ${error.message}`, { cause: error })
        return count ?? 0
    }
}

/** Composition seam: bind an EmbeddingIndex to the SERVICE-ROLE client (the
 *  embedding-maintenance path is always service-role — see the file header). */
export function createServiceEmbeddingIndex(): EmbeddingIndex {
    return new SupabaseEmbeddingIndex(createServiceClient())
}
