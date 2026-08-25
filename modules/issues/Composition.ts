// Issues module composition root. Wiring only: this is the one file in the
// module allowed to reach for infrastructure and the Supabase seam, which is why
// createIssueEmbedder lives here rather than beside the class it builds.

import { getAnalyser } from "@/modules/analysis"
import { getSpendGate } from "@/modules/billing"
import { createSupabaseProjectsRepository } from "@/modules/projects"
import { Supabase } from "@/lib/server/supabase"
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
    // The billing hard gate, as a predicate: resolve the project's team on the
    // CONTROL plane (`projects` lives there), then ask whether it may spend. Kept
    // here rather than inside IssueEmbedder so the issues module keeps knowing
    // nothing about billing.
    const canSpend = async (projectId: string): Promise<boolean> => {
        const teamId = await createSupabaseProjectsRepository(Supabase.service()).findTeamId(projectId)
        if (!teamId) return false
        return !(await getSpendGate().check(teamId))
    }
    return new IssueEmbedder(getAnalyser(), createServiceEmbeddingIndex(dataDb), canSpend)
}
