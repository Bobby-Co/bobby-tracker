// Deciding what a review round actually reviews.
//
// Every push used to re-review the whole pull request. On a twelve-file PR that
// meant round 3 spending six minutes re-deriving eleven files it had already
// read twice, to report three findings it had already reported. The cost is not
// the main problem — the TURN BUDGET is. The KB review loop is capped at 14
// turns and a `quick` plan clamps that to nine: nine tool-call turns to walk the
// graph, verify every draft finding, enumerate callers, probe failures, read
// history, and then write JSON. It routinely runs out mid-walk. Scoping the deep
// pass to what actually changed is the most direct fix we have for that.
//
// RULES, NOT A MODEL. A model that reasons about whether a change "needs" a full
// review is tempting and should wait. The interesting case — a one-line edit to
// a shared kernel function — is already answered deterministically by the
// dependent count, and more reliably than a model forming an impression of a
// diff. If the logged reasons later show a large ambiguous middle, add one, but
// give it ASYMMETRIC AUTHORITY: it may escalate incremental → full, never
// downgrade full → incremental. A wrong escalation costs six minutes; a wrong
// downgrade costs a review nobody performed, with the merge gate reading the
// result.
//
// PURE. Nothing here does I/O; the caller gathers the facts and this decides.

import { touchesMigration, type ScannableFile } from "./DiffFacts"

export type ReviewScopeKind = "full" | "incremental"

/** Why the scope is what it is. A stable code so the decision is queryable
 *  ("how often does the migration rule fire?") without parsing prose. */
export type ScopeReasonCode =
    | "first_round"
    | "degraded_baseline"
    | "no_previous_head"
    | "ancestry_unknown"
    | "force_push"
    | "base_moved"
    | "empty_push"
    | "migration"
    | "profile_changed"
    | "blast_radius"
    | "periodic"
    | "carried_saturation"
    /** Not a rule — the analyser cell refused an incremental request, so the
     *  round fell back to reviewing everything. Recorded as its own code because
     *  it is the only "full" that means a deploy is half-finished rather than
     *  that a rule fired. */
    | "dispatch_refused"
    | "push_scoped"

export interface ScopeDecision {
    scope: ReviewScopeKind
    code: ScopeReasonCode
    /** One line, written for a human reading the round record. */
    reason: string
}

/** How the last reviewed head relates to this one, as the provider reports it.
 *  `unknown` is NOT a synonym for `diverged` — it means we could not establish
 *  the relationship — but both force a full review, because a scope decision has
 *  to be able to prove its premise. */
export type Ancestry = "identical" | "ahead" | "behind" | "diverged" | "unknown"

export interface ScopeInput {
    /** The last COMPLETED round, or null on a first review. */
    previous: {
        headSha: string
        degraded: boolean
        baseSha: string | null
        /** The profile id that reviewed it; null for the built-in default. */
        profileId: string | null
        round: number
    } | null
    /** This review's heads. */
    headSha: string | null
    baseSha: string | null
    /** How previous.headSha relates to headSha. */
    ancestry: Ancestry
    /** The files between the two heads — the push itself. */
    pushFiles: ScannableFile[]
    /** The profile about to review; null for the built-in default. */
    profileId: string | null
    /** Rounds since the last FULL pass, not counting this one. */
    roundsSinceFull: number
    /** What fraction of the previous round's findings rode along unexamined, and
     *  how many that was. Both, because the fraction alone is a poor proxy on a
     *  short list — see minCarriedForSaturation. */
    carriedFraction: number
    carriedCount: number
    /** The largest dependent count among the symbols this push changed, or null
     *  when the graph could not be asked. Null does NOT force a full review: the
     *  count is an escalation signal, and treating an unavailable signal as an
     *  alarm would make every graph blip cost six minutes. */
    dependents: number | null
    /** Overrides, for tests and for tuning without a redeploy. */
    limits?: Partial<ScopeLimits>
}

export interface ScopeLimits {
    /** N — a changed symbol with more dependents than this is the "looks small,
     *  isn't" case, and gets the full pass. */
    maxDependents: number
    /** M — how many consecutive incremental rounds may pass before the pipeline
     *  looks at everything again. Bounds how long a finding can ride along
     *  unexamined, and gives the pipeline a way to recover from a bad baseline. */
    maxRoundsSinceFull: number
    /** The share of a findings list that may be carried before the next round is
     *  forced full. A review that is mostly assumptions is not a review. */
    maxCarriedFraction: number
    /** …but only once enough findings are riding along to be worth the six
     *  minutes. Observed on MR !4: a round carried 2 of 2 findings, hit 100%
     *  saturation, and forced the next round full. Two findings is not a review
     *  made of assumptions, and how long those two may ride unexamined is
     *  already bounded by maxRoundsSinceFull. Without a floor here, any pull
     *  request whose findings sit in files the pushes do not touch alternates
     *  full/incremental forever and never gets two cheap rounds in a row —
     *  which is most of the benefit, gone to a rule meant to protect it. */
    minCarriedForSaturation: number
}

export const SCOPE_LIMITS: ScopeLimits = {
    maxDependents: 25,
    maxRoundsSinceFull: 4,
    maxCarriedFraction: 0.75,
    minCarriedForSaturation: 4,
}

/** Decide, and say why.
 *
 *  Order matters only for which reason gets REPORTED — every rule below returns
 *  "full", so no ordering can change the outcome. They are arranged from the
 *  most fundamental ("there is nothing to carry") to the most tunable ("it has
 *  been a while"), which is the order a reader asks them in. */
export function decideScope(input: ScopeInput): ScopeDecision {
    const limits = { ...SCOPE_LIMITS, ...(input.limits ?? {}) }
    const full = (code: ScopeReasonCode, reason: string): ScopeDecision => ({ scope: "full", code, reason })

    const prev = input.previous
    if (!prev) return full("first_round", "first review of this pull request — nothing to carry")
    if (!prev.headSha) return full("no_previous_head", "the last round recorded no head, so no range can be compared")
    if (!input.headSha) return full("no_previous_head", "this push reports no head, so no range can be compared")

    // A partial review is not a baseline. Carrying from one would manufacture
    // the appearance of progress out of findings nobody made.
    if (prev.degraded) return full("degraded_baseline", "the last round did not complete, so it is not a baseline")

    // Force-push or rebase. The relationship between the two heads cannot be
    // established, so nothing may be carried — the "untouched file" premise the
    // whole carry rule rests on is unprovable across a rewritten history.
    if (input.ancestry === "diverged" || input.ancestry === "behind") {
        return full("force_push", "the branch was force-pushed or rebased since the last round")
    }
    if (input.ancestry === "unknown") {
        return full("ancestry_unknown", "the last reviewed head could not be placed in this branch's history")
    }

    // base…head changed for reasons the push did not cause: the diff under review
    // is different from the one the last round saw, whatever the head did.
    if (prev.baseSha && input.baseSha && prev.baseSha !== input.baseSha) {
        return full("base_moved", "the pull request's base moved since the last round")
    }

    if (input.pushFiles.length === 0) {
        return full("empty_push", "the push changed no files, so an incremental pass would review nothing")
    }

    // Schema changes reach code the diff never mentions — the tasks.tenant_id
    // rename broke tasks-repo.ts without appearing in it.
    if (touchesMigration(input.pushFiles)) {
        return full("migration", "this push touches a migration, which reaches code the diff never mentions")
    }

    // Different lenses, different blocking bar: round n would be judged by a
    // different reviewer than round n−1, and carrying one's findings into the
    // other's list would attribute them to a reviewer that never made them.
    if ((prev.profileId ?? null) !== (input.profileId ?? null)) {
        return full("profile_changed", "the review profile changed since the last round")
    }

    // The "looks small, isn't" case. A lookup, not an inference.
    if (input.dependents != null && input.dependents > limits.maxDependents) {
        return full(
            "blast_radius",
            `a symbol this push changed has ${input.dependents} dependents in the graph (over ${limits.maxDependents})`,
        )
    }

    if (input.carriedCount >= limits.minCarriedForSaturation && input.carriedFraction >= limits.maxCarriedFraction) {
        return full(
            "carried_saturation",
            `${input.carriedCount} findings — ${Math.round(input.carriedFraction * 100)}% of the last round — rode along unexamined`,
        )
    }

    if (input.roundsSinceFull >= limits.maxRoundsSinceFull) {
        return full("periodic", `${input.roundsSinceFull} rounds since the last full pass`)
    }

    return {
        scope: "incremental",
        code: "push_scoped",
        reason: `reviewing the ${input.pushFiles.length} file${input.pushFiles.length === 1 ? "" : "s"} this push changed`,
    }
}

/** How many rounds have run since the last full one, newest first.
 *
 *  Rounds written before scope existed have no scope recorded, and every one of
 *  them WAS a full review — so an absent scope counts as full rather than as an
 *  unknown that would force a full pass on the first round after deploy. */
export function roundsSinceFull(rounds: { scope?: string | null }[]): number {
    let n = 0
    for (const r of rounds) {
        if ((r.scope ?? "full") === "full") return n
        n++
    }
    return n
}
