// The PullRequest domain aggregate — the pull-requests context's entity for a
// PR's LIFECYCLE. (Merge eligibility is a separate policy — see merge-gate.ts,
// which combines a PR with its review.)
//
// The lifecycle rules — "is this closed?", the merged/closed/draft/open cascade —
// were re-derived across the app: the pulls list page (`merged || closed`), the
// review route (same, plus `draft`), and pr-meta's display cascade. They belong
// to the PR. Pure domain: no I/O, framework, or SDK — CLIENT-SAFE, so the PR
// surfaces import it from this path directly (not the server-tainted barrel).

export type PrState = "open" | "closed"

export type PullRequestLifecycle = "merged" | "closed" | "draft" | "open"

/** The PR state the lifecycle rules read. */
export interface PullRequestState {
    merged: boolean
    state: PrState
    draft: boolean
}

export class PullRequest {
    private constructor(private readonly s: PullRequestState) {}

    static of(state: PullRequestState): PullRequest {
        return new PullRequest(state)
    }

    isMerged(): boolean {
        return this.s.merged
    }

    /** Closed for the tracker's purposes — merged OR closed-without-merge.
     *  A closed PR's diff is history; there's nothing left to review or gate. */
    isClosed(): boolean {
        return this.s.merged || this.s.state === "closed"
    }

    isDraft(): boolean {
        return this.s.draft
    }

    isOpen(): boolean {
        return !this.isClosed()
    }

    /** The single display/lifecycle label, in priority order:
     *  merged > closed > draft > open. */
    lifecycle(): PullRequestLifecycle {
        if (this.s.merged) return "merged"
        if (this.s.state === "closed") return "closed"
        if (this.s.draft) return "draft"
        return "open"
    }
}
