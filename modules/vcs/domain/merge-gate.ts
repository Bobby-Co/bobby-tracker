// The single source of truth for "may this PR be merged from inside the tracker?"
//
// Pure and dependency-light on purpose: the merge bar (client) imports it to
// decide what to render, and the merge route (server) imports it to ENFORCE the
// decision before calling GitHub. If these two ever disagreed, the UI would
// offer a button the API rejects, or worse, the API would honour a merge the UI
// meant to block. One function, both sides.
//
// This gate is the PRODUCT policy, distinct from GitHub's own mechanical checks
// (conflicts, branch protection, required status checks). GitHub still has the
// final say at merge time and can refuse for reasons this gate knows nothing
// about — see the route's 405/409 handling. The gate only adds the two rules the
// user asked for on top of GitHub's:
//
//   1. Don't allow merge until the review has FINISHED.
//   2. Don't allow merge when the review found something CRITICAL.

import { findingState } from "@/lib/rendering/finding-state"

// Domain value-objects — the minimal PR + review shape this policy reads. Kept
// local (not the DB row types) so the gate stays a PURE domain rule with no SDK
// dependency; the persisted rows are structurally assignable to these.
export interface MergePull {
    merged: boolean
    state: "open" | "closed"
    draft: boolean
}

export interface MergeReview {
    status: "analysing" | "done" | "failed" | "cancelled" | null
    result: { findings?: { severity: string }[] } | null
}

export type MergeBlockCode =
    | "merged" // already merged — nothing to do
    | "closed" // closed without merging — reopen on GitHub to merge
    | "draft" // draft PRs can't be merged (GitHub rejects them too)
    | "no_review" // no analysis row at all
    | "review_pending" // analyser still running — will resolve on its own
    | "review_incomplete" // failed / cancelled — a dead end in-app; merge on GitHub
    | "critical" // review found ≥1 blocking finding

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
    /** Count of critical findings, so the UI can say "2 blockers" without
     *  re-deriving it from the result. 0 unless block.code === "critical". */
    criticalCount: number
}

/** Count findings the review marked as blocking, using the SAME normaliser the
 *  review panel groups by (the shared findingState) so the gate and the visible
 *  "Blockers" section can never disagree — if the panel shows a blocker, the gate
 *  counts it, and vice-versa. */
export function criticalFindingCount(analysis: MergeReview | null): number {
    const findings = analysis?.result?.findings ?? []
    return findings.filter((f) => findingState(f.severity) === "critical").length
}

export function mergeGate(pull: MergePull, analysis: MergeReview | null): MergeGate {
    const ok = (): MergeGate => ({ mergeable: true, block: null, criticalCount: 0 })
    const no = (code: MergeBlockCode, label: string, transient: boolean, criticalCount = 0): MergeGate => ({
        mergeable: false,
        block: { code, label, transient },
        criticalCount,
    })

    // PR lifecycle first — these are true regardless of the review, and merging a
    // merged/closed/draft PR is meaningless (GitHub would reject the last two).
    if (pull.merged) return no("merged", "Merged", false)
    if (pull.state === "closed") return no("closed", "Closed without merging", false)
    if (pull.draft) return no("draft", "Draft — mark ready first", false)

    // The review gate — the user's rule #1. A PR with no review, or one still in
    // flight, isn't cleared to merge here (GitHub stays available as the manual
    // override). "pending" is transient; the others need action elsewhere.
    if (!analysis || analysis.status == null) return no("no_review", "Awaiting review", true)
    if (analysis.status === "analysing") return no("review_pending", "Review in progress…", true)
    if (analysis.status !== "done") {
        // failed | cancelled — the review won't complete on its own.
        return no("review_incomplete", "Review didn't finish — merge on GitHub", false)
    }

    // Rule #2 — a finished review that flagged blockers holds the merge.
    const criticalCount = criticalFindingCount(analysis)
    if (criticalCount > 0) {
        return no(
            "critical",
            `Review found ${criticalCount} blocker${criticalCount === 1 ? "" : "s"}`,
            false,
            criticalCount,
        )
    }

    return ok()
}

// ── merge methods ────────────────────────────────────────────────────────────
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

/** GitHub's own default preference order when several methods are enabled. */
export function defaultMergeMethod(methods: MergeMethods): MergeMethod | null {
    if (methods.merge) return "merge"
    if (methods.squash) return "squash"
    if (methods.rebase) return "rebase"
    return null
}
