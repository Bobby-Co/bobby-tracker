// Pull Requests domain — finding-severity policy. A review finding's STATE (its
// traffic-light disposition: "critical" blocks a merge, "review" wants a manual
// look, "good") is a DOMAIN RULE, not presentation. It previously lived in
// lib/badge.ts — a rendering module — and was imported by the merge gate, so
// merge eligibility literally depended on a badge file. It now lives here; the
// merge gate, the email counts, and the PR-comment rendering all depend on this
// policy instead of on a rendering module.
//
// Pure domain: no I/O, no framework, no SDK.

export type FindingState = "critical" | "review" | "good"

/** Classify a finding's stored severity into its traffic-light state (analyser
 *  ADR-0056) — by impact, not by topic (the topic is in the title). Normalises
 *  the legacy bug/risk/style/nit vocabulary so old stored rows still classify. */
export function findingState(s: string): FindingState {
    if (s === "critical" || s === "bug") return "critical"
    if (s === "good") return "good"
    return "review" // review, risk, style, nit, or anything else
}
