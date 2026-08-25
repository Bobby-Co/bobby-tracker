import { test, expect, describe } from "bun:test"
import { decideScope, roundsSinceFull, type ScopeInput } from "./ReviewScope"

const base = (over: Partial<ScopeInput> = {}): ScopeInput => ({
    previous: { headSha: "45e02d1", degraded: false, baseSha: "main0", profileId: "p1", round: 2 },
    headSha: "063dc1e",
    baseSha: "main0",
    ancestry: "ahead",
    pushFiles: [{ path: "src/console/view.ts", patch: "@@\n+const x = 1" }],
    profileId: "p1",
    roundsSinceFull: 1,
    carriedFraction: 0.2,
    carriedCount: 1,
    dependents: 3,
    ...over,
})

describe("decideScope — the happy path", () => {
    test("an ordinary push is reviewed incrementally", () => {
        const d = decideScope(base())
        expect(d.scope).toBe("incremental")
        expect(d.code).toBe("push_scoped")
        expect(d.reason).toContain("1 file")
    })
})

describe("decideScope — the rules that force a full pass", () => {
    test("no previous round: nothing to carry", () => {
        expect(decideScope(base({ previous: null }))).toMatchObject({ scope: "full", code: "first_round" })
    })

    test("a degraded previous round is not a baseline", () => {
        const d = decideScope(base({ previous: { headSha: "x", degraded: true, baseSha: "main0", profileId: "p1", round: 2 } }))
        expect(d).toMatchObject({ scope: "full", code: "degraded_baseline" })
    })

    test("a force-push cannot place the last head in this history", () => {
        expect(decideScope(base({ ancestry: "diverged" }))).toMatchObject({ scope: "full", code: "force_push" })
        expect(decideScope(base({ ancestry: "behind" }))).toMatchObject({ scope: "full", code: "force_push" })
    })

    // "unknown" is not a synonym for "diverged" — but a scope decision has to be
    // able to prove its premise, so both end in the same place.
    test("an unestablished ancestry forces a full pass", () => {
        expect(decideScope(base({ ancestry: "unknown" }))).toMatchObject({ scope: "full", code: "ancestry_unknown" })
    })

    test("a moved base changes the diff for reasons the push did not cause", () => {
        expect(decideScope(base({ baseSha: "main1" }))).toMatchObject({ scope: "full", code: "base_moved" })
    })

    test("a push with no files would review nothing", () => {
        expect(decideScope(base({ pushFiles: [] }))).toMatchObject({ scope: "full", code: "empty_push" })
    })

    test("a migration reaches code the diff never mentions", () => {
        const d = decideScope(base({ pushFiles: [{ path: "supabase/migrations/0081_x.sql" }] }))
        expect(d).toMatchObject({ scope: "full", code: "migration" })
    })

    test("a changed profile means a different reviewer judged the last round", () => {
        expect(decideScope(base({ profileId: "p2" }))).toMatchObject({ scope: "full", code: "profile_changed" })
    })

    test("moving from a profile to the default counts as a change", () => {
        expect(decideScope(base({ profileId: null }))).toMatchObject({ scope: "full", code: "profile_changed" })
    })

    test("the looks-small-isn't case: too many dependents", () => {
        const d = decideScope(base({ dependents: 300 }))
        expect(d).toMatchObject({ scope: "full", code: "blast_radius" })
        expect(d.reason).toContain("300 dependents")
    })

    // An unavailable signal is not an alarm; treating it as one would make every
    // graph blip cost six minutes.
    test("an unavailable dependent count does not force a full pass", () => {
        expect(decideScope(base({ dependents: null })).scope).toBe("incremental")
    })

    test("a saturated carried list means the next round looks again", () => {
        const d = decideScope(base({ carriedFraction: 0.9, carriedCount: 9 }))
        expect(d).toMatchObject({ scope: "full", code: "carried_saturation" })
        expect(d.reason).toContain("9 findings")
    })

    // Observed on MR !4: a round carried 2 of 2 findings, hit 100% saturation and
    // forced the next round full. Two findings is not a review made of
    // assumptions, and maxRoundsSinceFull already bounds how long they may ride.
    // Without this floor, a pull request whose findings sit in untouched files
    // alternates full/incremental forever and never gets two cheap rounds.
    test("a short list is not 'saturated' just because all of it carried", () => {
        expect(decideScope(base({ carriedFraction: 1, carriedCount: 2 })).scope).toBe("incremental")
    })

    test("the floor is a floor, not a replacement — a big list still trips it", () => {
        expect(decideScope(base({ carriedFraction: 1, carriedCount: 4 }))).toMatchObject({ code: "carried_saturation" })
    })

    test("a big list that is mostly fresh does not trip it", () => {
        expect(decideScope(base({ carriedFraction: 0.3, carriedCount: 6 })).scope).toBe("incremental")
    })

    test("the periodic rule bounds how long a finding rides along unexamined", () => {
        expect(decideScope(base({ roundsSinceFull: 4 }))).toMatchObject({ scope: "full", code: "periodic" })
    })

    test("the thresholds are overridable without a redeploy", () => {
        const d = decideScope(base({ dependents: 30, limits: { maxDependents: 100 } }))
        expect(d.scope).toBe("incremental")
    })
})

describe("decideScope — reporting", () => {
    test("every decision carries a reason a human can read", () => {
        for (const input of [base(), base({ previous: null }), base({ ancestry: "diverged" }), base({ dependents: 99 })]) {
            expect(decideScope(input).reason.length).toBeGreaterThan(10)
        }
    })
})

describe("roundsSinceFull", () => {
    test("zero when the newest round was full", () => {
        expect(roundsSinceFull([{ scope: "full" }, { scope: "incremental" }])).toBe(0)
    })

    test("counts the incremental streak", () => {
        expect(roundsSinceFull([{ scope: "incremental" }, { scope: "incremental" }, { scope: "full" }])).toBe(2)
    })

    // Every round written before scope existed WAS a full review, so an absent
    // scope must not read as an unknown that forces a full pass after deploy.
    test("a round with no scope recorded counts as full", () => {
        expect(roundsSinceFull([{}, {}])).toBe(0)
        expect(roundsSinceFull([{ scope: null }])).toBe(0)
    })

    test("an empty history is zero", () => {
        expect(roundsSinceFull([])).toBe(0)
    })
})
