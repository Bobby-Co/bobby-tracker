// Analysis domain — analyser-readiness policy. An indexed knowledge graph is the
// precondition for suggestions/PR review: nothing runs until the analyser is
// enabled, its status is "ready", and it has a graph_id to run against. This rule
// lived inline as a negative guard in two large files (lib/github-sync.ts and
// lib/pr-sync.ts); it is now one policy expressed positively.
//
// Pure domain: no I/O, no framework, no SDK.

import { ProjectAnalyser } from "./project-analyser"

/** Readiness shape common to the callers' analyser rows. */
type AnalyserReadiness = {
    enabled?: boolean | null
    status?: string | null
    graph_id?: string | null
}

/** True when the analyser is enabled, indexed ("ready"), and has a graph to run
 *  against — the precondition for issue suggestions and PR review.
 *
 *  A TYPE GUARD, not a bare predicate: on the `if (!isAnalyserReady(a)) return`
 *  path the callers rely on `a` narrowing to non-null with a non-null `graph_id`
 *  (they pass `a.graph_id` straight to the analyser), exactly as the old inline
 *  `!a?.enabled || a.status !== "ready" || !a.graph_id` guard narrowed it. */
export function isAnalyserReady<T extends AnalyserReadiness>(
    a: T | null | undefined,
): a is T & { graph_id: string } {
    // Delegates to the ProjectAnalyser aggregate (single source of the rule); the
    // type-guard NARROWING is preserved by this signature.
    return ProjectAnalyser.from(a).isReady()
}
