// Issues application — the IssueEmbedder. Owns the "keep every issue indexed for
// similarity search" use case: embed one issue's text (via the Analyser port),
// persist the vector (via the EmbeddingIndex port), and sweep a project's
// backlog. Best-effort by design — a failure logs and leaves the row for a later
// sweep, never breaking issue creation.
//
// Pure application: depends only on the Analyser port + the EmbeddingIndex port;
// the composition seam below injects the concrete, service-role-backed adapters.

import type { AnalyserPort } from "@/modules/analysis"
import { getAnalyser } from "@/modules/analysis"
import type { EmbeddingIndex } from "../ports/EmbeddingIndex"
import { createServiceEmbeddingIndex } from "../infrastructure/SupabaseEmbeddingIndex"
import { issueEmbeddingText } from "../domain/EmbeddingText"

/** The minimal issue shape the embedder needs. Structural, so a freshly-inserted
 *  row can be passed straight in. */
export interface EmbeddableIssue {
    id: string
    project_id: string
    title: string
    body: string
}

export class IssueEmbedder {
    constructor(
        private readonly analyser: AnalyserPort,
        private readonly index: EmbeddingIndex,
    ) {}

    /** Embed one issue and upsert its vector. Best-effort — a failure logs and
     *  leaves the row in the backlog for ensureEmbeddings() to pick up later
     *  (never throws, so it can't break the caller's insert). */
    async embedIssue(issue: EmbeddableIssue): Promise<void> {
        try {
            const result = await this.analyser.embed(issueEmbeddingText(issue))
            await this.index.upsert({
                issueId: issue.id,
                projectId: issue.project_id,
                vector: result.vector,
                model: result.model,
            })
        } catch (err) {
            console.error(`[IssueEmbedder] failed to embed issue ${issue.id}:`, err)
        }
    }

    /** How many of this project's issues still have no embedding. Drives the
     *  "Embedding N issues…" chip; 0 on a read failure (degrade, never throw). */
    async countUnembedded(projectId: string): Promise<number> {
        try {
            return await this.index.countUnembedded(projectId)
        } catch (err) {
            console.error(`[IssueEmbedder] count ${projectId}:`, err)
            return 0
        }
    }

    /** Embed up to `limit` of a project's unembedded issues, oldest first. The
     *  repair path for rows that entered outside the two hand-created routes
     *  (chiefly the bulk importer) plus any embed that failed silently.
     *
     *  BOUNDED and re-entrant by necessity — there is no cron in this stack, so
     *  each GET /api/projects/[id]/activity schedules one batch via after().
     *  Overlapping sweeps are harmless (the upsert is idempotent). Sequential on
     *  purpose — fanning a whole backlog at the analyser buys no latency here. */
    async ensureEmbeddings(projectId: string, limit = 10): Promise<number> {
        let rows
        try {
            rows = await this.index.findUnembedded(projectId, limit)
        } catch (err) {
            console.error(`[IssueEmbedder] sweep ${projectId}:`, err)
            return 0
        }
        let filled = 0
        for (const issue of rows) {
            await this.embedIssue({
                id: issue.id,
                project_id: issue.project_id,
                title: issue.title ?? "",
                body: issue.body ?? "",
            })
            filled++
        }
        return filled
    }
}

/** Composition seam: the app-wide IssueEmbedder — the HTTP analyser + the
 *  service-role embedding index. */
export function createIssueEmbedder(): IssueEmbedder {
    return new IssueEmbedder(getAnalyser(), createServiceEmbeddingIndex())
}
