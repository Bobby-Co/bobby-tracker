import { test, expect, describe } from "bun:test"
import { carriedFraction, changedPathSet, mergeRound, partitionForCarry } from "./CarryForward"
import type { PrFinding } from "@/lib/shared/types"

const f = (over: Partial<PrFinding> = {}): PrFinding => ({
    file: "src/tasks/search-repo.ts",
    line: 12,
    severity: "critical",
    category: "bug",
    title: "SQL injection in searchTasks",
    detail: "interpolates owner into the query",
    ...over,
})

describe("partitionForCarry", () => {
    test("an untouched file with untouched symbols rides along", () => {
        const p = partitionForCarry({ previous: [f()], changedFiles: ["src/other.ts"], changedSymbols: ["unrelated"] })
        expect(p.carried).toHaveLength(1)
        expect(p.reJudge).toHaveLength(0)
    })

    test("a finding whose file is in the push goes back", () => {
        const p = partitionForCarry({
            previous: [f()],
            changedFiles: ["src/tasks/search-repo.ts"],
            changedSymbols: [],
        })
        expect(p.carried).toHaveLength(0)
        expect(p.reJudge).toHaveLength(1)
        expect(p.reasons[0].why).toContain("its file is in this push")
    })

    test("path comparison is normalised the way identity compares it", () => {
        const p = partitionForCarry({
            previous: [f({ file: "SRC/Tasks/Search-Repo.ts" })],
            changedFiles: ["src/tasks/search-repo.ts"],
            changedSymbols: [],
        })
        expect(p.carried).toHaveLength(0)
    })

    // The second clause of the carry rule. Blast radius is global: deleting a
    // caller elsewhere can resolve a finding in a file this push never touched.
    test("a changed exported symbol named in the text forces a re-judge", () => {
        const p = partitionForCarry({
            previous: [f()],
            changedFiles: ["src/other.ts"],
            changedSymbols: ["searchTasks"],
        })
        expect(p.reJudge).toHaveLength(1)
        expect(p.reasons[0].why).toContain("searchTasks")
    })

    test("a changed symbol named only in the DETAIL counts too", () => {
        const p = partitionForCarry({
            previous: [f({ title: "unsafe query", detail: "resolveSession never checks the team" })],
            changedFiles: ["src/other.ts"],
            changedSymbols: ["resolveSession"],
        })
        expect(p.reJudge).toHaveLength(1)
    })

    test("a moved evidence anchor forces a re-judge — the grounding changed", () => {
        const finding = f({ evidence: [{ file: "src/db/client.ts", line: 4, kind: "caller" }] })
        const p = partitionForCarry({ previous: [finding], changedFiles: ["src/db/client.ts"], changedSymbols: [] })
        expect(p.reJudge).toHaveLength(1)
        expect(p.reasons[0].why).toContain("src/db/client.ts")
    })

    test("a finding with no file can never be proved untouched", () => {
        const p = partitionForCarry({ previous: [f({ file: "" })], changedFiles: ["a.ts"], changedSymbols: [] })
        expect(p.reJudge).toHaveLength(1)
        expect(p.reasons[0].why).toContain("no file")
    })

    test("every previous finding lands in exactly one bucket", () => {
        const previous = [f(), f({ file: "a.ts", title: "one" }), f({ file: "b.ts", title: "two" })]
        const p = partitionForCarry({ previous, changedFiles: ["a.ts"], changedSymbols: [] })
        expect(p.carried.length + p.reJudge.length).toBe(previous.length)
    })
})

describe("changedPathSet", () => {
    test("carries both sides of a rename", () => {
        const s = changedPathSet([{ path: "New.ts", previous_path: "Old.ts" }])
        expect(s.has("new.ts")).toBe(true)
        expect(s.has("old.ts")).toBe(true)
    })
})

describe("mergeRound", () => {
    const blocker = f({ file: "src/a.ts", title: "blocker A" })
    const other = f({ file: "src/b.ts", title: "blocker B" })

    // The failure this whole module exists to stop: a carried blocker must reach
    // result.findings, because that is the list the merge gate counts.
    test("a carried blocker lands in the ONE findings list", () => {
        const m = mergeRound({ produced: [other], carried: [blocker], round: 2, headSha: "abc" })
        expect(m.findings.map((x) => x.title)).toEqual(["blocker B", "blocker A"])
        expect(m.counts.carried).toBe(1)
    })

    test("a carried finding is marked carried; a produced one is marked verified", () => {
        const m = mergeRound({ produced: [other], carried: [blocker], round: 3, headSha: "abc" })
        const produced = m.findings.find((x) => x.title === "blocker B")!
        const carried = m.findings.find((x) => x.title === "blocker A")!
        expect(produced.provenance).toMatchObject({ lastVerifiedRound: 3, carried: false })
        expect(carried.provenance?.carried).toBe(true)
        expect(carried.provenance?.lastVerifiedRound).toBeLessThan(3)
    })

    test("the reviewer's own report wins over the carried copy", () => {
        const fresh = f({ file: "src/a.ts", title: "blocker A", line: 40 })
        const m = mergeRound({ produced: [fresh], carried: [blocker], round: 2, headSha: "abc" })
        expect(m.findings).toHaveLength(1)
        expect(m.findings[0].line).toBe(40)
        expect(m.findings[0].provenance?.carried).toBe(false)
    })

    test("a reviewer that says the same thing twice does not make the gate count two", () => {
        const dup = f({ file: "src/a.ts", title: "Security: blocker A" })
        const m = mergeRound({ produced: [blocker, dup], carried: [], round: 1, headSha: "abc" })
        expect(m.findings).toHaveLength(1)
    })

    test("stamping never mutates the stored snapshot it came from", () => {
        const stored = f({ file: "src/a.ts" })
        mergeRound({ produced: [], carried: [stored], round: 2, headSha: "abc" })
        expect(stored.provenance).toBeUndefined()
    })

    describe("provenance dating", () => {
        test("a finding present in an earlier round dates to that round", () => {
            const m = mergeRound({
                produced: [blocker],
                carried: [],
                round: 4,
                headSha: "abc",
                history: [
                    { round: 3, findings: [blocker] },
                    { round: 1, findings: [blocker] },
                ],
            })
            expect(m.findings[0].provenance?.firstSeenRound).toBe(1)
        })

        test("a stored firstSeenRound reaches further back than the window", () => {
            const old = f({ file: "src/a.ts", provenance: { firstSeenRound: 1, lastVerifiedRound: 6, carried: false } })
            const m = mergeRound({
                produced: [],
                carried: [old],
                round: 8,
                headSha: "abc",
                history: [{ round: 7, findings: [old] }],
            })
            expect(m.findings[0].provenance?.firstSeenRound).toBe(1)
            expect(m.findings[0].provenance?.lastVerifiedRound).toBe(6)
        })

        test("a genuinely new finding dates to this round", () => {
            const m = mergeRound({ produced: [blocker], carried: [], round: 5, headSha: "abc", history: [{ round: 4, findings: [] }] })
            expect(m.findings[0].provenance?.firstSeenRound).toBe(5)
        })
    })

    describe("resolution", () => {
        test("a previous blocker the round did not report is resolved by this head", () => {
            const m = mergeRound({
                produced: [other],
                carried: [],
                round: 2,
                headSha: "063dc1e",
                history: [{ round: 1, findings: [blocker, other] }],
            })
            expect(m.resolved).toHaveLength(1)
            expect(m.resolved[0].title).toBe("blocker A")
            expect(m.resolved[0].provenance?.resolvedBy).toBe("063dc1e")
        })

        test("a resolved finding leaves the live list, so the gate stays clean", () => {
            const m = mergeRound({
                produced: [other],
                carried: [],
                round: 2,
                headSha: "abc",
                history: [{ round: 1, findings: [blocker, other] }],
            })
            expect(m.findings.map((x) => x.title)).toEqual(["blocker B"])
        })

        test("a positive note vanishing is not an achievement", () => {
            const good = f({ file: "src/c.ts", severity: "good", title: "nice test" })
            const m = mergeRound({ produced: [], carried: [], round: 2, headSha: "abc", history: [{ round: 1, findings: [good] }] })
            expect(m.resolved).toHaveLength(0)
        })

        test("a carried blocker is NOT reported as resolved", () => {
            const m = mergeRound({
                produced: [],
                carried: [blocker],
                round: 2,
                headSha: "abc",
                history: [{ round: 1, findings: [blocker] }],
            })
            expect(m.resolved).toHaveLength(0)
            expect(m.findings).toHaveLength(1)
        })
    })

    describe("the degraded round", () => {
        // A round that did not complete did not read anything, so its silence is
        // an absence rather than a judgement.
        test("resolves nothing", () => {
            const m = mergeRound({
                produced: [],
                carried: [],
                round: 2,
                headSha: "abc",
                degraded: true,
                history: [{ round: 1, findings: [blocker] }],
            })
            expect(m.resolved).toHaveLength(0)
        })

        test("carries the re-judged blockers it never spoke about", () => {
            const m = mergeRound({
                produced: [],
                carried: [],
                reJudged: [blocker],
                round: 2,
                headSha: "abc",
                degraded: true,
                history: [{ round: 1, findings: [blocker] }],
            })
            expect(m.findings).toHaveLength(1)
            expect(m.findings[0].provenance?.carried).toBe(true)
        })

        test("does not carry a re-judged NOTE — only blockers gate a merge", () => {
            const note = f({ file: "src/a.ts", severity: "review", title: "worth a look" })
            const m = mergeRound({ produced: [], carried: [], reJudged: [note], round: 2, headSha: "abc", degraded: true })
            expect(m.findings).toHaveLength(0)
        })

        test("a COMPLETED round treats the reviewer's silence as a judgement", () => {
            const m = mergeRound({ produced: [], carried: [], reJudged: [blocker], round: 2, headSha: "abc" })
            expect(m.findings).toHaveLength(0)
        })
    })
})

describe("carriedFraction", () => {
    test("is zero for an empty list", () => {
        expect(carriedFraction([])).toBe(0)
    })

    test("counts only what rode along unexamined", () => {
        const carried = f({ provenance: { firstSeenRound: 1, lastVerifiedRound: 1, carried: true } })
        const fresh = f({ file: "b.ts", provenance: { firstSeenRound: 2, lastVerifiedRound: 2, carried: false } })
        expect(carriedFraction([carried, fresh])).toBe(0.5)
    })
})

// The bug the first working incremental round produced: the analyser judged the
// three files in the push, found them clean, and returned "approve" with 10/10.
// The tracker then carried two findings in — one of them critical — and stored
// that headline over them. The merge gate held, because it counts `findings`;
// every human-facing signal said the pull request was clean.
describe("mergeRound — the headline over the merged list", () => {
    const blocker = f({ file: "migrations/0011.sql", title: "drops a column live code reads" })
    const clean = { produced: [], carried: [blocker], round: 2, headSha: "abc" }

    test("a carried blocker turns approve into changes requested", () => {
        const m = mergeRound({ ...clean, verdict: "approve", score: 10 })
        expect(m.verdict).toBe("request_changes")
    })

    test("a carried NOTE does not — only blockers gate a merge", () => {
        const note = f({ file: "x.ts", severity: "review", title: "worth a look" })
        const m = mergeRound({ produced: [], carried: [note], round: 2, headSha: "abc", verdict: "approve", score: 9 })
        expect(m.verdict).toBe("approve")
    })

    // The verdict and score of a full round describe exactly the findings it
    // produced. Touching them there would invent a disagreement rather than
    // resolve one.
    test("a full round's headline is passed through untouched", () => {
        const m = mergeRound({ produced: [blocker], carried: [], round: 1, headSha: "abc", verdict: "approve", score: 10 })
        expect(m.verdict).toBe("approve")
        expect(m.score).toBe(10)
    })

    describe("the score floor", () => {
        const carried = f({
            file: "migrations/0011.sql",
            title: "drops a column live code reads",
            provenance: { firstSeenRound: 1, lastVerifiedRound: 1, carried: true },
        })

        test("cannot score better than the round that raised the finding", () => {
            const m = mergeRound({
                produced: [], carried: [carried], round: 2, headSha: "abc", verdict: "approve", score: 10,
                history: [{ round: 1, findings: [carried], score: 1 }],
            })
            expect(m.score).toBe(1)
        })

        test("a worse round does not drag a better one down further", () => {
            const m = mergeRound({
                produced: [], carried: [carried], round: 2, headSha: "abc", score: 3,
                history: [{ round: 1, findings: [carried], score: 8 }],
            })
            expect(m.score).toBe(3)
        })

        // A floor, not a recomputation: the formula lives in the analyser and a
        // second implementation here would be one more thing to drift.
        test("a round with no score does not acquire one by carrying", () => {
            const m = mergeRound({
                produced: [], carried: [carried], round: 2, headSha: "abc", score: null,
                history: [{ round: 1, findings: [carried], score: 4 }],
            })
            expect(m.score).toBeNull()
        })

        test("an unscored history leaves the score alone", () => {
            const m = mergeRound({
                produced: [], carried: [carried], round: 2, headSha: "abc", score: 7,
                history: [{ round: 1, findings: [carried] }],
            })
            expect(m.score).toBe(7)
        })
    })
})
