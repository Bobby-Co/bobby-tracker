// Carrying findings across an incremental review, and merging the round.
//
// This is the part of incremental review that can open a merge on a pull request
// nobody reviewed, so it is pure, it is arithmetic, and its tests were written
// first.
//
// THE PROBLEM IT SOLVES. MergeGate counts criticals in `result.findings`, and
// findings are REPLACED WHOLESALE every round. Review only the last push and a
// still-present blocker in an untouched file is simply absent from the new list
// — the gate sees zero criticals and opens the merge. Full re-review is what
// prevents that today; it is not thoroughness for its own sake, it is the thing
// that gives the reviewer a fair chance to re-find what it found before.
//
// THE RULE THAT MAKES IT SAFE. If a finding's file is untouched between the last
// reviewed head and this one, and no exported symbol it cites was changed
// elsewhere, the finding is still there. Nothing needs to be asked. Everything
// else goes back to the reviewer to re-judge.
//
// The second clause is not decoration: blast radius is global, so deleting a
// caller in file X can resolve a finding in untouched file Y, and carrying it
// forward would report a defect that no longer exists.

import type { PrFinding } from "@/lib/shared/types"
import { findingFile, sameFinding } from "./ReviewRounds"
import { mentionedSymbol, type ScannableFile } from "./DiffFacts"
import { findingState } from "@/lib/shared/rendering/finding-state"

// ─── partition ──────────────────────────────────────────────────────────────

export interface CarryInput {
    /** The previous round's COMPLETE findings list. */
    previous: PrFinding[]
    /** Every path in the incremental diff, including pre-image paths of renames. */
    changedFiles: string[]
    /** Exported symbol names this push defines differently (see DiffFacts). */
    changedSymbols: string[]
}

/** Why a finding is going back to the reviewer, as a short phrase for the log
 *  and the round record. */
export type ReJudgeReason = { finding: PrFinding; why: string }

export interface CarryPartition {
    /** Safe to inherit verbatim: untouched file, untouched symbols. */
    carried: PrFinding[]
    /** Must be re-judged — handed to the reviewer as `previous_blockers`. */
    reJudge: PrFinding[]
    /** One line per re-judged finding, so a round can say WHY it re-judged
     *  rather than only that it did. Ordered with `reJudge`. */
    reasons: ReJudgeReason[]
}

function normalisePath(p: string): string {
    return (p ?? "").trim().toLowerCase()
}

/** Every path the diff touches, both sides of a rename, normalised. */
export function changedPathSet(files: ScannableFile[]): Set<string> {
    const out = new Set<string>()
    for (const f of files) {
        if (f.path) out.add(normalisePath(f.path))
        if (f.previous_path) out.add(normalisePath(f.previous_path))
    }
    return out
}

/** Split the last round's findings into the ones that ride along and the ones
 *  that go back for a decision.
 *
 *  Errs toward re-judging in every ambiguous case — a finding with no file, a
 *  finding whose EVIDENCE sits in a changed file, a finding whose text names a
 *  changed export. Each of those costs one line in a checklist the reviewer was
 *  already given; the opposite error costs a defect reported as live when it is
 *  stale, or worse, a stale finding that the gate keeps counting. */
export function partitionForCarry(input: CarryInput): CarryPartition {
    const changed = new Set(input.changedFiles.map(normalisePath))
    const carried: PrFinding[] = []
    const reJudge: PrFinding[] = []
    const reasons: ReJudgeReason[] = []

    const send = (f: PrFinding, why: string) => {
        reJudge.push(f)
        reasons.push({ finding: f, why })
    }

    for (const f of input.previous) {
        const path = findingFile(f)
        if (path === "") {
            send(f, "no file — cannot prove it is untouched")
            continue
        }
        if (changed.has(path)) {
            send(f, "its file is in this push")
            continue
        }

        // The grounding moved even though the finding's own file did not. An
        // anchor in a changed file is the reviewer's own statement of what this
        // finding rests on, so a change there is a change to the finding.
        const movedAnchor = (f.evidence ?? []).find((e) => e.file && changed.has(normalisePath(e.file)))
        if (movedAnchor) {
            send(f, `its evidence at ${movedAnchor.file} is in this push`)
            continue
        }

        const text = `${f.title ?? ""} ${f.detail ?? ""}`
        const symbol = mentionedSymbol(text, input.changedSymbols)
        if (symbol) {
            send(f, `it names ${symbol}, which this push changed`)
            continue
        }

        carried.push(f)
    }

    return { carried, reJudge, reasons }
}

// ─── merge ──────────────────────────────────────────────────────────────────

/** One earlier round, as the merge reads it. */
export interface RoundSnapshot {
    round: number
    findings: PrFinding[]
    /** What that round scored. Read only to keep a later round from scoring
     *  BETTER than the round whose findings it is still carrying. */
    score?: number | null
}

export interface MergeRoundInput {
    /** What the reviewer produced THIS round. */
    produced: PrFinding[]
    /** Carried verbatim — never examined this round. Empty on a full review. */
    carried: PrFinding[]
    /** Sent back for a decision. Only consulted when this round is degraded; see
     *  the note in mergeRound. Empty on a full review. */
    reJudged?: PrFinding[]
    /** This round's ordinal and the head it reviewed. */
    round: number
    headSha: string
    /** The verdict and score the REVIEWER produced, before the merge. Both
     *  describe only what it looked at, which on an incremental round is not the
     *  list the surfaces end up rendering — see the note on `verdict` below. */
    verdict?: string
    score?: number | null
    /** This round's grounded pass did not complete. */
    degraded?: boolean
    /** The rounds before this one, NEWEST FIRST. Used only to date a finding
     *  (`firstSeenRound`) and to work out what this round resolved. */
    history?: RoundSnapshot[]
}

export interface MergedRound {
    /** The ONE list — carried + re-judged + newly found. This is what the merge
     *  gate counts and what both surfaces render; a carried finding living in a
     *  side channel would be invisible to both, which is the failure the whole
     *  design exists to avoid. */
    findings: PrFinding[]
    /** Blocking findings the previous round had that this one does not, each
     *  stamped with the head that closed it. Stored on the round so a reader can
     *  see what their push fixed; never part of `findings`, so the gate stays
     *  clean. */
    resolved: PrFinding[]
    /** The verdict for the MERGED list, which is not always the one the reviewer
     *  produced.
     *
     *  The analyser derives its verdict deterministically from the findings it
     *  raised — and on an incremental round those are only the push's. Carry two
     *  findings in afterwards and the stored review says "approve" over a list
     *  containing a critical: the merge gate blocks (it counts `findings`) while
     *  every human-facing signal says the pull request is clean. That is the
     *  same shape as every fail-open this pipeline has had, pointed the other
     *  way — the truth is in the list, and the headline disagrees with it.
     *
     *  So the verdict is re-derived here, over the list that is actually stored.
     *  Deterministic and one rule: a blocker in the list means changes are
     *  requested. */
    verdict?: string
    /** The score for the merged list, floored by the rounds the carried findings
     *  came from.
     *
     *  NOT recomputed — the analyser's formula lives there and mirroring it here
     *  would be a second implementation to drift. What this can say honestly is
     *  that a review carrying a finding cannot score better than the review that
     *  raised it — the finding is still open, and nothing this round did to
     *  other files changes that. */
    score?: number | null
    counts: { produced: number; carried: number; resolved: number }
}

/** Assemble the round's stored findings list.
 *
 *  PURE and total: given the same inputs it produces the same list, which is
 *  what makes "what did the gate see" answerable months later from the round
 *  row alone.
 *
 *  The one non-obvious rule is the DEGRADED case. A re-judged finding that the
 *  reviewer neither re-reported nor spoke about is normally dropped — the file
 *  was in the diff, the reviewer read it, and silence is a judgement. But a
 *  round whose grounded pass never completed did not read anything, so its
 *  silence is an absence, not an answer, and dropping a blocker on it would be
 *  the same fail-open in a new place. On a degraded round the unspoken
 *  re-judged blockers are carried instead. */
export function mergeRound(input: MergeRoundInput): MergedRound {
    const round = input.round
    const history = input.history ?? []
    const degraded = input.degraded === true

    // 1. The reviewer's own list, de-duplicated. A reviewer that reports the same
    //    defect twice under two wordings should not make the gate count two.
    const live: PrFinding[] = []
    for (const f of input.produced) {
        if (live.some((k) => sameFinding(k, f))) continue
        live.push(stamp(f, { firstSeenRound: firstSeen(f, history, round), lastVerifiedRound: round, carried: false }))
    }

    // 2. The carried findings the reviewer did NOT independently report. One it
    //    did report wins: it was actually looked at this round, so it keeps the
    //    fresher line number and the fresher provenance.
    let carriedCount = 0
    for (const f of input.carried) {
        if (live.some((k) => sameFinding(k, f))) continue
        const prov = f.provenance
        live.push(
            stamp(f, {
                firstSeenRound: prov?.firstSeenRound ?? firstSeen(f, history, round),
                lastVerifiedRound: prov?.lastVerifiedRound ?? lastKnownRound(history, round),
                carried: true,
            }),
        )
        carriedCount++
    }

    // 3. Degraded-round backstop — see the doc comment. Only BLOCKERS: a
    //    "worth a review" note surviving a partial round costs a reader nothing,
    //    while a blocker vanishing from one costs the merge gate everything.
    if (degraded) {
        for (const f of input.reJudged ?? []) {
            if (findingState(f.severity) !== "critical") continue
            if (live.some((k) => sameFinding(k, f))) continue
            const prov = f.provenance
            live.push(
                stamp(f, {
                    firstSeenRound: prov?.firstSeenRound ?? firstSeen(f, history, round),
                    lastVerifiedRound: prov?.lastVerifiedRound ?? lastKnownRound(history, round),
                    carried: true,
                }),
            )
            carriedCount++
        }
    }

    // 4. What this round closed. A degraded round resolves NOTHING, for the same
    //    reason diffRounds withholds: a blocker missing from a partial review is
    //    indistinguishable from a blocker that was fixed.
    const previous = history[0]
    const resolved =
        degraded || !previous
            ? []
            : previous.findings
                  .filter((p) => findingState(p.severity) === "critical")
                  .filter((p) => !live.some((k) => sameFinding(k, p)))
                  .map((p) =>
                      stamp(p, {
                          firstSeenRound: p.provenance?.firstSeenRound ?? firstSeen(p, history, previous.round),
                          lastVerifiedRound: p.provenance?.lastVerifiedRound ?? previous.round,
                          carried: false,
                          resolvedBy: input.headSha,
                      }),
                  )

    // 5. The headline, re-derived over the list that is actually stored.
    //
    //    Only when something was carried. A full round's verdict and score
    //    describe exactly the findings it produced, so touching them there would
    //    be inventing a disagreement with the analyser rather than resolving one.
    const carriedAnything = carriedCount > 0
    const verdict = carriedAnything && live.some(isBlocker) ? "request_changes" : input.verdict
    const score = carriedAnything ? floorScore(input.score, input.carried, history) : input.score

    return {
        findings: live,
        resolved,
        verdict,
        score,
        counts: { produced: input.produced.length, carried: carriedCount, resolved: resolved.length },
    }
}

/** A finding that gates a merge. The same normaliser the gate and both surfaces
 *  use, so none of the four can disagree about what a blocker is. */
function isBlocker(f: PrFinding): boolean {
    return findingState(f.severity) === "critical"
}

/** The score, floored by the rounds the carried findings were last verified in.
 *
 *  A review that is still carrying a finding cannot honestly score better than
 *  the review that raised it. Deliberately a FLOOR rather than a recomputation:
 *  the scoring formula lives in the analyser, and a second implementation here
 *  would be one more thing to drift. Null in, null out — a round with no score
 *  does not acquire one by carrying. */
function floorScore(produced: number | null | undefined, carried: PrFinding[], history: RoundSnapshot[]): number | null | undefined {
    if (produced == null || carried.length === 0) return produced
    let floor = produced
    for (const f of carried) {
        const at = f.provenance?.lastVerifiedRound
        const round = history.find((r) => r.round === at) ?? history[0]
        if (round?.score != null && round.score < floor) floor = round.score
    }
    return floor
}

/** Copy a finding with provenance attached. Never mutates the input: the same
 *  finding object is also sitting in a stored round snapshot, and stamping it in
 *  place would rewrite history. */
function stamp(f: PrFinding, provenance: PrFinding["provenance"]): PrFinding {
    return { ...f, provenance }
}

/** The earliest round in the window that already contained this finding, or the
 *  current round when none did.
 *
 *  Bounded by the window the caller fetched, so a finding older than the window
 *  dates to its oldest visible round. That is a floor rather than a guess: it
 *  says "at least this old", which is the honest reading of what we hold. A
 *  stored `provenance.firstSeenRound` beats it wherever one exists, and reaches
 *  further back than any window. */
function firstSeen(f: PrFinding, history: RoundSnapshot[], fallback: number): number {
    let earliest: number | null = null
    for (const r of history) {
        const hit = r.findings.find((h) => sameFinding(h, f))
        if (!hit) continue
        const stampedFirst = hit.provenance?.firstSeenRound
        const at = stampedFirst ?? r.round
        if (earliest === null || at < earliest) earliest = at
    }
    return earliest ?? fallback
}

/** The most recent round we hold, which is the newest a carried finding can
 *  honestly claim to have been verified at when nothing stamped it. */
function lastKnownRound(history: RoundSnapshot[], fallback: number): number {
    return history[0]?.round ?? Math.max(1, fallback - 1)
}

/** How much of a findings list rode along unexamined, 0..1. Feeds the
 *  periodic-full-review rule: a round whose findings are mostly assumptions is
 *  the point at which the pipeline should look again. */
export function carriedFraction(findings: PrFinding[]): number {
    if (findings.length === 0) return 0
    return findings.filter((f) => f.provenance?.carried === true).length / findings.length
}
