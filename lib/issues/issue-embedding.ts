// Best-effort embedding fill for newly-created issues. Used by both
// the authenticated POST /api/issues and the public POST
// /api/public-issues paths so every issue — wherever it came from —
// gets indexed for similarity search.
//
// Always uses the service-role client because:
//   1. The cookie-bound client may be torn down before the
//      fire-and-forget await resolves.
//   2. Public submissions have no auth cookie at all (link mode).
// RLS isn't a concern: the service-role client bypasses it, and the
// route handler has already done the relevant ownership / token
// checks before calling here.

import { createServiceClient } from "@/lib/supabase/server"
import { embedText, issueEmbeddingText, type EmbedResult } from "@/lib/analyser"

interface MinimalIssue {
    id: string
    title: string
    body: string
}

export async function embedIssueAsync(issue: MinimalIssue): Promise<void> {
    try {
        const result: EmbedResult = await embedText(issueEmbeddingText(issue))
        const svc = createServiceClient()
        const { error } = await svc
            .from("issue_embeddings")
            .upsert(
                {
                    issue_id: issue.id,
                    embedding: result.vector,
                    model: result.model,
                },
                { onConflict: "issue_id" },
            )
        if (error) throw error
    } catch (err) {
        // Embedding failure shouldn't break issue creation — the row
        // stays unembedded until a future edit / sweep fills it in.
        // But log it: a silently-swallowed failure here is exactly why
        // similarity shows "unavailable" for brand-new issues. Surfaces
        // in `wrangler tail` so analyser/config problems are visible.
        console.error(`[embedIssueAsync] failed to embed issue ${issue.id}:`, err)
    }
}
