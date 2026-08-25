// Notifications — the EnrichmentSource PORT. What a notification email needs in
// order to say something, beyond what the event itself carries.
//
// A domain event is deliberately thin: the facts that make the notification
// true, and nothing else. That's right for the feed row, where a title and a
// link is the whole artefact. It is not enough for an email, which has to stand
// on its own in an inbox — the review's findings, the PR's diff, the repository
// it all belongs to. Rather than fattening the event (and the outbox rows, and
// the triggers that write them) with presentation fuel, the email side looks the
// extra up at send time, through this port.
//
// Both senders load through it, so the two paths reach for the same facts and
// the templates can't tell which one is rendering them. A channel constructed
// without a source still delivers; the mail is just shorter.

import type { NotificationKind, PrAnalysis, PullRequest } from "@/lib/shared/types"

/** What to look up. Assembled from a domain event or a persisted feed row —
 *  whichever the sender has. */
export interface EnrichmentSubject {
    readonly kind: NotificationKind
    readonly projectId: string | null
    readonly prNumber: number | null
}

/** What was found. Every field is nullable BY CONTRACT: enrichment is
 *  best-effort, and a template that can't render a section drops it. */
export interface Enrichment {
    readonly projectName: string | null
    readonly repoFullName: string | null
    readonly pull: PullRequest | null
    readonly analysis: PrAnalysis | null
}

export const NO_ENRICHMENT: Enrichment = { projectName: null, repoFullName: null, pull: null, analysis: null }

export interface EnrichmentSource {
    /** Look up whatever this subject's kind can use. NEVER throws — a failed
     *  lookup costs the mail a section, not the send. */
    load(subject: EnrichmentSubject): Promise<Enrichment>
}
