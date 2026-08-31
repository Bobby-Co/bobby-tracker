// Which indexed tree a run is allowed to be answered from.
//
// Two rules live here, and both used to be re-derived at each call site:
//
//   1. What a branch NAME may look like. It is used verbatim as part of a
//      FalkorDB graph key, so a blank one — or one carrying whitespace — can
//      only address a graph nobody can reach. The database says the same thing
//      (project_branches' and issues' check constraints); this is that rule on
//      the way IN, so a bad name is refused with a message rather than a 500.
//
//   2. Whether a REQUESTED branch may actually be sent. The analyser refuses a
//      branch it has not indexed rather than falling back to the default, so
//      asking for one that is merely tracked — pending, indexing, failed — buys
//      an error instead of an answer. Only `ready` is answerable; everything
//      else resolves to the default tree, which is the behaviour every caller
//      had before branches existed.
//
// Pure domain: no I/O, no SDK, no framework — CLIENT-SAFE, so the composer can
// validate a name with the same rule the routes enforce.

/** The shape the resolver reads. Structural rather than the ProjectBranch row
 *  type, so domain/ stays free of the shared DB types. */
export interface TrackedBranchState {
    branch: string
    status: string
}

export class AnalysisBranch {
    /** A caller-supplied branch name, cleaned, or null when there is no usable
     *  one. Null is not an error: it is "the project's default tree", which is
     *  what an untagged issue and an unbranched query both mean. */
    static normalise(input: unknown): string | null {
        if (typeof input !== "string") return null
        const branch = input.trim()
        // Whitespace INSIDE the name, not merely around it — trimming already
        // handled the edges, and " " and "feat/ x" fail for different reasons.
        if (!branch || /\s/.test(branch)) return null
        return branch
    }

    /** The branch to send to the analyser for a requested name and the tracked
     *  row (if any) that was found for it — or undefined for "the default tree".
     *
     *  Undefined rather than null because that is what the Analyser port's
     *  optional `branch` wants: omitted means the default, and an explicit null
     *  would have to be stripped somewhere else anyway. */
    static answerable(tracked: TrackedBranchState | null | undefined): string | undefined {
        return tracked?.status === "ready" ? tracked.branch : undefined
    }
}
