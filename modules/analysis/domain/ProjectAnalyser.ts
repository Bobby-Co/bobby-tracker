// The ProjectAnalyser domain aggregate — a project's analyser (knowledge-graph)
// state. It owns the readiness + status rules that were re-derived INLINE in ~7
// places (knowledge/mind/issues pages, group routes, the project layout), each
// hand-writing `enabled && status === "ready" && graph_id`.
//
// Those sites inlined the rule because it had no client-safe home; this aggregate
// is pure + CLIENT-SAFE, so they import it from this domain path and stop
// duplicating. Readiness is `ProjectAnalyser.from(state).isReady()`, called
// directly at each site (from() is null-safe) — no free-function wrapper. Where a
// caller then needs the graph_id, isReady() having returned true guarantees it is
// present (assert at that one line).

export type AnalyserStatusValue = "disabled" | "pending" | "indexing" | "ready" | "failed"

/** Thoroughness level for issue analysis — the lowercase wire values the analyser
 *  expects on /issues/analyse + /issues/preferences, and the value stored in
 *  project_analyser.analyse_effort. (Distinct from the indexing `effort` on
 *  KickoffJobInput.) The list + validity check live on ProjectAnalyser below. */
export type AnalyseEffort = "fast" | "medium" | "high" | "veryhigh"

/** The analyser state the rules read. Fields are optional so the aggregate can
 *  be built from a bare status too (some views only inspect the status). */
export interface ProjectAnalyserState {
    enabled?: boolean | null
    status?: string | null
    graph_id?: string | null
}

const EMPTY: ProjectAnalyserState = {}

export class ProjectAnalyser {
    private constructor(private readonly s: ProjectAnalyserState) {}

    static of(state: ProjectAnalyserState): ProjectAnalyser {
        return new ProjectAnalyser(state)
    }

    /** Null-safe factory — an absent analyser row is a not-ready analyser. */
    static from(state: ProjectAnalyserState | null | undefined): ProjectAnalyser {
        return new ProjectAnalyser(state ?? EMPTY)
    }

    /** Indexed + enabled + has a graph to run against — the precondition for
     *  suggestions, chat, and PR review. */
    isReady(): boolean {
        return this.s.enabled === true && this.s.status === "ready" && !!this.s.graph_id
    }

    isEnabled(): boolean {
        return this.s.enabled === true
    }

    isIndexing(): boolean {
        return this.s.status === "indexing"
    }

    hasFailed(): boolean {
        return this.s.status === "failed"
    }

    /** A build has been kicked off at least once (indexing / ready / failed) — vs
     *  never-started (disabled / pending). */
    hasStarted(): boolean {
        return this.s.status === "indexing" || this.s.status === "ready" || this.s.status === "failed"
    }

    // ─── analyse-effort value set (owned here — it's an analyser attribute) ──────

    /** The four effort levels, low → high. Also the render order for pickers. */
    static readonly EFFORTS: readonly AnalyseEffort[] = ["fast", "medium", "high", "veryhigh"]

    /** Validity guard for an untrusted effort value (request bodies, stored column). */
    static isValidEffort(v: unknown): v is AnalyseEffort {
        return typeof v === "string" && (ProjectAnalyser.EFFORTS as readonly string[]).includes(v)
    }
}
