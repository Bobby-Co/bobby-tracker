// Round-over-round comparison of PR reviews.
//
// A re-review used to replace the last one, so the reviewer had no memory: it
// could not say you had fixed three of five blockers, could not notice that a
// fix introduced something new, and could not tell a finding that went away
// because you fixed it from one that went away because this round did not look.
//
// PURE. The delta is arithmetic over two finding lists — never a question put to
// a model. Every part of this system that asked a model to describe its own
// output has produced something confidently wrong; "what changed" is the last
// place that should start.

import type { PrFinding } from "@/lib/shared/types"
import { findingState } from "@/lib/shared/rendering/finding-state"

/** What happened to one finding, relative to the previous round. */
export type FindingDelta = "new" | "still_open" | "fixed" | "regressed"

export interface DeltaFinding {
    finding: PrFinding
    delta: FindingDelta
    /** Stable across rounds — see fingerprint(). */
    key: string
}

export interface RoundDelta {
    /** Every finding in the CURRENT round, tagged. */
    current: DeltaFinding[]
    /** Findings the previous round had and this one does not. Empty when the
     *  current round is degraded — see the note on resolve() below. */
    fixed: PrFinding[]
    /** Counts the surfaces render without re-deriving. */
    counts: { fixed: number; stillOpen: number; new: number; regressed: number }
    /** True when nothing may be treated as resolved because the round that would
     *  have resolved it did not complete. */
    withheld: boolean
}

/** One round's worth of what the delta needs. */
export interface RoundInput {
    headSha: string
    findings: PrFinding[]
    degraded?: boolean
}

// ─── identity ───────────────────────────────────────────────────────────────

/** A finding's identity across rounds.
 *
 *  LINE IS DELIBERATELY EXCLUDED. A fix three lines above moves every finding
 *  below it without changing any of them, and keying on line would report the
 *  whole file as fixed-and-reintroduced on any edit.
 *
 *  The title is normalised because the reviewer rewords itself between rounds:
 *  the same defect arrives as "SQL injection in searchTasks" one round and
 *  "Security: unparameterised SQL in searchTasks" the next. */
export function fingerprint(f: PrFinding): string {
    return [file(f), f.category ?? "", normaliseTitle(titleOf(f))].join("|")
}

function file(f: PrFinding): string {
    return (f.file ?? "").trim().toLowerCase()
}

function titleOf(f: PrFinding): string {
    const t = (f.title ?? "").trim()
    return t !== "" ? t : (f.detail ?? "")
}

/** Lower-case, drop a leading category tag ("Security: …"), strip punctuation,
 *  collapse whitespace. */
export function normaliseTitle(raw: string): string {
    return raw
        .toLowerCase()
        .replace(/^[a-z][a-z /&_-]{2,24}:\s*/i, "")
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
}

const STOPWORDS = new Set(["the", "a", "an", "in", "on", "of", "to", "and", "or", "is", "for", "via", "with", "by"])

function tokens(title: string): Set<string> {
    return new Set(normaliseTitle(title).split(" ").filter((w) => w.length > 2 && !STOPWORDS.has(w)))
}

/** How alike two titles are, 0..1 — the fraction of the smaller token set the
 *  two share. Asymmetric overlap rather than Jaccard on purpose: a round that
 *  says MORE about the same defect should still match the terser round. */
export function titleSimilarity(a: string, b: string): number {
    const ta = tokens(a)
    const tb = tokens(b)
    if (ta.size === 0 || tb.size === 0) return 0
    let shared = 0
    for (const w of ta) if (tb.has(w)) shared++
    return shared / Math.min(ta.size, tb.size)
}

/** The bar for calling two differently-worded findings the same one. Tuned to be
 *  reached by a rewording and not by two different defects in one file: below
 *  this, an unmatched finding is simply reported as new, which is the safe
 *  direction — a duplicate in the list costs a reader a moment, a wrongly
 *  matched one hides a real defect behind a stale title. */
const SIMILAR_ENOUGH = 0.6

// ─── the delta ──────────────────────────────────────────────────────────────

/** Compare a round against the one before it.
 *
 *  `previous` is the last COMPLETED round, or null for the first review of a PR.
 *  `earlier` is every round before that, newest first, and is only consulted to
 *  tell a genuinely new finding from one that was fixed and has come back.
 */
export function diffRounds(current: RoundInput, previous: RoundInput | null, earlier: RoundInput[] = []): RoundDelta {
    const currentKeyed = current.findings.map((f) => ({ finding: f, key: fingerprint(f) }))

    if (!previous) {
        return {
            current: currentKeyed.map((c) => ({ ...c, delta: "new" as const })),
            fixed: [],
            counts: { fixed: 0, stillOpen: 0, new: currentKeyed.length, regressed: 0 },
            withheld: false,
        }
    }

    const prev = previous.findings.map((f) => ({ finding: f, key: fingerprint(f) }))
    const matchedPrev = new Set<string>()

    const tagged: DeltaFinding[] = currentKeyed.map((c) => {
        const hit = matchIn(prev, c)
        if (hit) {
            matchedPrev.add(hit.key)
            return { ...c, delta: "still_open" }
        }
        const wasFixed = earlier.some((r) => r.findings.some((f) => same({ finding: f, key: fingerprint(f) }, c)))
        return { ...c, delta: wasFixed ? "regressed" : "new" }
    })

    // A round that did not complete may not resolve anything. Its findings are
    // the diff-level draft at best, and a blocker missing from a partial review
    // is indistinguishable from a blocker that was fixed — resolving it would
    // open the merge on a pull request nobody reviewed.
    const withheld = current.degraded === true
    const gone = withheld ? [] : prev.filter((p) => !matchedPrev.has(p.key) && blocks(p.finding)).map((p) => p.finding)

    return {
        current: tagged,
        fixed: gone,
        counts: {
            fixed: gone.length,
            stillOpen: tagged.filter((t) => t.delta === "still_open").length,
            new: tagged.filter((t) => t.delta === "new").length,
            regressed: tagged.filter((t) => t.delta === "regressed").length,
        },
        withheld,
    }
}

/** Exact fingerprint first, then one fuzzy pass over the same file+category. */
function matchIn(pool: { finding: PrFinding; key: string }[], target: { finding: PrFinding; key: string }) {
    const exact = pool.find((p) => p.key === target.key)
    if (exact) return exact
    return pool.find((p) => same(p, target))
}

function same(a: { finding: PrFinding; key: string }, b: { finding: PrFinding; key: string }): boolean {
    if (a.key === b.key) return true
    if (file(a.finding) !== file(b.finding)) return false
    if ((a.finding.category ?? "") !== (b.finding.category ?? "")) return false
    return titleSimilarity(titleOf(a.finding), titleOf(b.finding)) >= SIMILAR_ENOUGH
}

/** Only findings that GATE a merge count as "fixed" — a positive note vanishing
 *  between rounds is not an achievement, and counting it as one would inflate
 *  the progress line with things nobody set out to do. */
function blocks(f: PrFinding): boolean {
    return findingState(f.severity) === "critical"
}

/** "3 of 5 blockers resolved, 2 remain" — the one line both surfaces show.
 *  Returns null when there is nothing to say (a first review, or no blockers on
 *  either side), so a caller can omit the line rather than print a zero. */
export function progressLine(delta: RoundDelta, currentBlockers: number): string | null {
    if (delta.withheld) {
        return "this round did not complete — nothing is counted as resolved"
    }
    const started = delta.counts.fixed + currentBlockers
    if (started === 0 || delta.counts.fixed === 0) return null
    if (currentBlockers === 0) {
        return `all ${delta.counts.fixed} blocker${delta.counts.fixed === 1 ? "" : "s"} resolved`
    }
    return `${delta.counts.fixed} of ${started} blockers resolved, ${currentBlockers} remain`
}
