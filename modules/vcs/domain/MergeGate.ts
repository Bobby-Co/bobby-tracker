// The single source of truth for "may this PR be merged from inside the tracker?"
// The merge bar (client) renders from it and the merge route (server) ENFORCES
// it, so the UI can never offer a button the API rejects. This is the PRODUCT
// policy on top of GitHub's own mechanical checks (GitHub still has the final say):
//   1. Don't allow merge until the review has FINISHED.
//   2. Don't allow merge when the review found something CRITICAL.

import { findingState } from "@/lib/shared/rendering/finding-state"

// Domain value-objects — the minimal PR + review shape the policy reads. Kept
// local (not the DB rows) so it stays a pure rule; the rows are assignable to these.
export interface MergePull {
    merged: boolean
    state: "open" | "closed"
    draft: boolean
}

export interface MergeReview {
    status: "analysing" | "done" | "failed" | "cancelled" | null
    result: { findings?: { severity: string }[]; degraded?: boolean } | null
}

/** How this review compares with the one before it (0080), when there was one.
 *  Purely for what the bar SAYS — the gate's decision is the findings, as it has
 *  always been. */
export interface MergeProgress {
    /** Blockers the previous round had that this one does not. */
    fixed: number
}

export type MergeBlockCode =
    | "merged"
    | "closed"
    | "draft"
    | "no_review"
    | "review_pending"
    | "review_incomplete"
    | "critical"
    | "review_partial"

export interface MergeBlock {
    code: MergeBlockCode
    /** One line, shown verbatim on the disabled control. */
    label: string
    /** Whether waiting will clear this (pending) vs the user must act elsewhere. */
    transient: boolean
}

export interface MergeGate {
    mergeable: boolean
    block: MergeBlock | null
    /** Critical-finding count, so the UI can say "2 blockers" without re-deriving. */
    criticalCount: number
}

export type MergeMethod = "merge" | "squash" | "rebase"

export interface MergeMethods {
    merge: boolean
    squash: boolean
    rebase: boolean
}

export const MERGE_METHOD_LABEL: Record<MergeMethod, string> = {
    merge: "Create a merge commit",
    squash: "Squash and merge",
    rebase: "Rebase and merge",
}

export class MergePolicy {
    /** Count blocking findings using the SAME normaliser the review panel groups
     *  by (shared findingState), so the gate and the visible "Blockers" section can
     *  never disagree. */
    criticalFindingCount(analysis: MergeReview | null): number {
        const findings = analysis?.result?.findings ?? []
        return findings.filter((f) => findingState(f.severity) === "critical").length
    }

    /** Evaluate the merge gate for a PR + its review.
     *
     *  `progress` is optional and affects only the wording: "3 of 5 resolved,
     *  2 remain" reads very differently from "2 blockers" to somebody who has
     *  been fixing them, and the difference costs nothing to compute. */
    evaluate(pull: MergePull, analysis: MergeReview | null, progress?: MergeProgress): MergeGate {
        const ok = (): MergeGate => ({ mergeable: true, block: null, criticalCount: 0 })
        const no = (code: MergeBlockCode, label: string, transient: boolean, criticalCount = 0): MergeGate => ({
            mergeable: false,
            block: { code, label, transient },
            criticalCount,
        })

        // PR lifecycle first — merging a merged/closed/draft PR is meaningless.
        if (pull.merged) return no("merged", "Merged", false)
        if (pull.state === "closed") return no("closed", "Closed without merging", false)
        if (pull.draft) return no("draft", "Draft — mark ready first", false)

        // Rule #1 — the review must have finished (GitHub stays the manual override).
        if (!analysis || analysis.status == null) return no("no_review", "Awaiting review", true)
        if (analysis.status === "analysing") return no("review_pending", "Review in progress…", true)
        if (analysis.status !== "done") {
            return no("review_incomplete", "Review didn't finish — merge on GitHub", false)
        }

        // Rule #2 — a finished review that flagged blockers holds the merge.
        const criticalCount = this.criticalFindingCount(analysis)
        if (criticalCount > 0) {
            const fixed = progress?.fixed ?? 0
            const label = fixed > 0
                ? `${fixed} of ${fixed + criticalCount} blockers resolved — ${criticalCount} left`
                : `Review found ${criticalCount} blocker${criticalCount === 1 ? "" : "s"}`
            return no("critical", label, false, criticalCount)
        }

        // Rule #3 — a review whose grounded pass did not complete has not cleared
        // anything. Its findings are the diff-level draft, so an EMPTY blocker
        // list here means "we did not look", not "there is nothing wrong" — and
        // merging on it would be merging on a review that never happened. This is
        // the one rule that fires on an absence rather than a finding, which is
        // exactly why it has to exist: every other gate reads what was found.
        if (analysis.result?.degraded === true) {
            return no("review_partial", "Review didn't complete — re-run before merging", true)
        }

        return ok()
    }

    /** GitHub's own default preference order when several methods are enabled. */
    defaultMethod(methods: MergeMethods): MergeMethod | null {
        if (methods.merge) return "merge"
        if (methods.squash) return "squash"
        if (methods.rebase) return "rebase"
        return null
    }
}
