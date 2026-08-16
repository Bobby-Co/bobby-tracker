// Issues module composition root. Wiring only: this is the one file in the
// module allowed to reach for infrastructure and the Supabase seam, which is why
// createIssueEmbedder lives here rather than beside the class it builds.

import { getAnalyser } from "@/modules/analysis"
import type { SupabaseRlsClient } from "@/lib/server/supabase"
import { IssueEmbedder } from "./application/IssueEmbedder"
import { createServiceEmbeddingIndex } from "./infrastructure/SupabaseEmbeddingIndex"

/** The app-wide IssueEmbedder — the HTTP analyser + the service-role embedding
 *  index.
 *
 *  `dataDb` is the project's REGIONAL client. `issue_embeddings` and `issues`
 *  both live there, and an embedding written to the wrong region is invisible to
 *  the similarity search that region's analyser runs — a silent empty result
 *  rather than an error, which is why the parameter is worth threading through
 *  every caller. */
export function createIssueEmbedder(dataDb?: SupabaseRlsClient): IssueEmbedder {
    return new IssueEmbedder(getAnalyser(), createServiceEmbeddingIndex(dataDb))
}
