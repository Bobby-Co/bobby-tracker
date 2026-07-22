// Shapes an issue (or a compose proposal) into the plain text handed to the
// embedder for similarity search and cross-project routing — how an issue is
// represented as text. Pure domain: no I/O, no SDK. IssueComposeProposal is a
// type-only import (the erased import creates no runtime cycle).

import type { IssueComposeProposal } from "@/modules/analysis"

export class EmbeddingText {
    /** Title + body, so similarity reflects what the issue is about; truncated to
     *  stay under the embedding model's input window without a tokenizer. */
    forIssue(issue: { title: string; body: string }): string {
        const title = (issue.title ?? "").trim()
        const body = (issue.body ?? "").trim()
        return `${title}\n\n${body}`.slice(0, 7500)
    }

    /** The single routing vector's text: the routing_summary plus per-tag lines
     *  shaped exactly like the project tag-pool phrases ("layer <slug>: <desc>",
     *  "feature <slug>: <desc>"), so one vector lands well against both a project's
     *  main and per-tag embeddings. Falls back to title+body when the analyser
     *  returned no routing fields (older builds). */
    forRouting(proposal: IssueComposeProposal): string {
        const summary = (proposal.routing_summary ?? "").trim()
        const layer = (proposal.layer ?? "").toString().trim()
        const features = (proposal.features ?? []).map((t) => (t ?? "").toString().trim()).filter(Boolean)

        if (!summary && !layer && features.length === 0) {
            return this.forIssue({ title: proposal.title, body: proposal.body })
        }

        const lines: string[] = []
        if (summary) lines.push(summary)
        // Never embed a bare "layer frontend." with no body — that's the
        // low-context vector this shaping exists to avoid.
        const tagDescription = summary || "described above"
        if (layer) lines.push(`layer ${layer}: ${tagDescription}`)
        for (const feature of features) lines.push(`feature ${feature}: ${tagDescription}`)
        return lines.join("\n").slice(0, 7500)
    }
}
