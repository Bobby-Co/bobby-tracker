// Issues port — the embedding index. The persistence side of similarity-search
// maintenance: writing an issue's vector and finding/counting the issues that
// still lack one. The IssueEmbedder (application) depends on this role; the
// Supabase implementation owns the partitioned-table detail (see
// SupabaseEmbeddingIndex) and is obtained via the composition seam.

/** A project issue that has no embedding row yet — the shape a sweep reads. */
export interface UnembeddedIssue {
    id: string
    /** Partition key — issue_embeddings is PARTITIONED BY project_id, so every
     *  write must carry it. */
    project_id: string
    title: string
    body: string
}

/** One issue's embedding, ready to persist. */
export interface EmbeddingUpsert {
    issueId: string
    projectId: string
    vector: number[]
    model: string
}

export interface EmbeddingIndex {
    /** Upsert an issue's embedding (idempotent on the partition key). Throws
     *  RepositoryError on a DB failure — the caller decides whether to degrade. */
    upsert(row: EmbeddingUpsert): Promise<void>
    /** Up to `limit` of a project's unembedded issues, oldest first. */
    findUnembedded(projectId: string, limit: number): Promise<UnembeddedIssue[]>
    /** How many of a project's issues still have no embedding. */
    countUnembedded(projectId: string): Promise<number>
}
