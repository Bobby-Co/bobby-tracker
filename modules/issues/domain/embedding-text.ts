// Issues domain — embedding-text shaping. These functions turn an issue (or a
// compose proposal) into the plain text we hand to the embedder for similarity
// search and cross-project routing. That's pure DOMAIN logic — how an issue is
// represented as text — and it had leaked into lib/analyser.ts, an HTTP client
// for the analyser service. It now lives here; the analyser client no longer
// carries it.
//
// Pure domain: no I/O, no framework, no SDK. IssueComposeProposal is imported
// type-only from the analyser client (it stays the return type of composeIssue
// there); the erased import creates no runtime dependency or cycle.

import type { IssueComposeProposal } from "@/lib/analyser"

// Compose the text we feed to the embedder. We concatenate title +
// body so similarity reflects what the issue is *about*, not just
// title overlap. Truncated to a generous slice to stay under the
// embedding model's input window without a tokenizer.
export function issueEmbeddingText(issue: { title: string; body: string }): string {
    const body = (issue.body ?? "").trim()
    const title = (issue.title ?? "").trim()
    return `${title}\n\n${body}`.slice(0, 7500)
}

// Pick the text we embed for cross-project routing. ONE vector per
// issue, compared against each project's main embedding AND its
// per-tag embeddings by find_similar_projects.
//
// We deliberately shape the text to mirror BOTH targets so a single
// vector lands well in either subspace:
//
//   - First line(s): the analyser's domain/surface routing_summary
//     in plain maintainer voice. Matches the project's main
//     embedding (which is itself a prose blob mixing overview +
//     layer/feature descriptions).
//
//   - Then per-dimension lines shaped EXACTLY like the project tag
//     phrases the analyser produces:
//
//         "layer <slug>: <description>"
//         "feature <slug>: <description>"
//
//     Project tags are embedded as "<projectName> — layer <slug>:
//     <description>" so the trailing "<kind> <slug>: <description>"
//     n-grams dominate the cosine similarity. Repeating the
//     routing_summary as the description for each tag dimension
//     gives the embedding model the shared structure it needs to
//     pull the issue vector toward the project's tag-pool space.
//
// Falls back to title+body when the analyser didn't return any
// routing fields at all (older analyser builds).
export function routingEmbeddingText(proposal: IssueComposeProposal): string {
    const summary = (proposal.routing_summary ?? "").trim()
    const layer = (proposal.layer ?? "").toString().trim()
    const features = (proposal.features ?? [])
        .map((t) => (t ?? "").toString().trim())
        .filter(Boolean)

    if (!summary && !layer && features.length === 0) {
        return issueEmbeddingText({ title: proposal.title, body: proposal.body })
    }

    const lines: string[] = []
    if (summary) lines.push(summary)
    // Per-tag-dimension lines that mimic the project tag-pool phrase
    // shape. The description after the colon is the routing_summary
    // (or the slug itself when summary is empty) so we never embed
    // a bare "layer frontend." with no body — that's exactly the
    // low-context vector the redesign was meant to avoid.
    const tagDescription = summary || "described above"
    if (layer) {
        lines.push(`layer ${layer}: ${tagDescription}`)
    }
    for (const feature of features) {
        lines.push(`feature ${feature}: ${tagDescription}`)
    }
    return lines.join("\n").slice(0, 7500)
}
