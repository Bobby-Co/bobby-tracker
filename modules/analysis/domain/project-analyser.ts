// The ProjectAnalyser domain aggregate — a project's analyser (knowledge-graph)
// state. It owns the readiness + status rules that were re-derived INLINE in ~7
// places (knowledge/mind/issues pages, group routes, the project layout), each
// hand-writing `enabled && status === "ready" && graph_id`.
//
// Those sites inlined the rule because the existing isAnalyserReady lives behind
// the server-tainted analysis barrel; this aggregate is pure + CLIENT-SAFE, so
// they can import it from this domain path and stop duplicating. isAnalyserReady
// (the type guard callers rely on for graph_id narrowing) now delegates here, so
// the rule is single-sourced.

export type AnalyserStatusValue = "disabled" | "pending" | "indexing" | "ready" | "failed"

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
}
