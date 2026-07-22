// Finding-state classification — the SHARED policy that maps a review finding's
// stored severity to its traffic-light state ("critical" blocks a merge,
// "review" wants a manual look, "good"). It is depended on from BOTH sides of the
// layer boundary: the pull-requests merge gate (domain — merge eligibility) and
// badge/PR-comment/email rendering (presentation). Living in one shared, pure,
// dependency-free place is what lets both use it without either importing the
// other — earlier it sat in pull-requests/domain and `lib/rendering/badge.ts`
// imported it, an upward lib→module cycle. Pure: no I/O, framework, or SDK.

export type FindingState = "critical" | "review" | "good"

/** Classify a finding's stored severity into its traffic-light state (analyser
 *  ADR-0056) — by impact, not by topic (the topic is in the title). Normalises
 *  the legacy bug/risk/style/nit vocabulary so old stored rows still classify. */
export function findingState(s: string): FindingState {
    if (s === "critical" || s === "bug") return "critical"
    if (s === "good") return "good"
    return "review" // review, risk, style, nit, or anything else
}
