import { test, expect, describe } from "bun:test"
import {
    DEFAULT_DIALS,
    DEFAULT_LENSES,
    DIAL_SPECS,
    LENSES,
    PRESETS,
    affectsMergeGate,
    clampDepth,
    compilePolicy,
    matchingPreset,
    maxDepthForTier,
    parseDials,
    parseLenses,
    presetByKey,
    type ReviewProfile,
} from "./ReviewProfile"

function profile(over: Partial<ReviewProfile> = {}): ReviewProfile {
    return {
        id: "p1",
        team_id: "t1",
        name: "Test",
        preset: "balanced",
        dials: DEFAULT_DIALS,
        lenses: [...DEFAULT_LENSES],
        instructions: "",
        path_rules: [],
        created_by: null,
        updated_by: null,
        created_at: "",
        updated_at: "",
        ...over,
    }
}

describe("dials", () => {
    test("a value written by a newer app degrades instead of throwing", () => {
        // This runs on the path that decides whether a PR gets reviewed at all.
        // A settings page showing stale options is recoverable; a webhook throwing
        // on an unknown dial value is a pull request that never gets a review.
        const d = parseDials({ strictness: "aggressive", blocking: 42, voice: null, unknown: "x" })
        expect(d).toEqual(DEFAULT_DIALS)
    })

    test("garbage in place of the whole blob is still a complete set of dials", () => {
        for (const junk of [null, undefined, "", 0, [], "nope"]) {
            expect(parseDials(junk)).toEqual(DEFAULT_DIALS)
        }
    })

    test("valid values survive", () => {
        const d = parseDials({ ...DEFAULT_DIALS, strictness: "quiet", depth: "deep" })
        expect(d.strictness).toBe("quiet")
        expect(d.depth).toBe("deep")
        expect(d.voice).toBe(DEFAULT_DIALS.voice)
    })

    test("every dial has a spec, and every spec option is a real value", () => {
        // The UI is generated from DIAL_SPECS, so a dial without one is invisible
        // and an option that isn't a real value is a control that silently does
        // nothing when saved.
        const specced = new Set(DIAL_SPECS.map((s) => s.key))
        for (const key of Object.keys(DEFAULT_DIALS)) {
            expect(specced.has(key as keyof typeof DEFAULT_DIALS)).toBe(true)
        }
        for (const spec of DIAL_SPECS) {
            const parsed = spec.options.map((o) => parseDials({ [spec.key]: o.value })[spec.key])
            expect(parsed).toEqual(spec.options.map((o) => o.value))
        }
    })
})

describe("lenses", () => {
    test("always-on lenses are never stored", () => {
        // They run regardless. Storing them would make "all off" indistinguishable
        // from "never edited", which is the one distinction the analyser needs.
        const parsed = parseLenses(["correctness", "blast_radius", "test_gap", "security"])
        expect(parsed).toEqual(["security"])
    })

    test("unknown keys are dropped and the order is the catalogue's", () => {
        expect(parseLenses(["security", "hologram", "convention", 7, null])).toEqual(["convention", "security"])
    })

    test("an empty list stays empty rather than becoming the default", () => {
        // The distinction the whole nil-vs-empty contract rests on.
        expect(parseLenses([])).toEqual([])
        expect(parseLenses(null)).toEqual([])
    })

    test("every lens the presets name actually exists", () => {
        const known = new Set(LENSES.map((l) => l.key))
        for (const p of PRESETS) {
            for (const k of p.lenses) {
                expect(known.has(k)).toBe(true)
            }
        }
    })
})

describe("compiling to the analyser", () => {
    test("no profile sends nothing at all", () => {
        // Not a default-valued policy: an analyser cell deployed before policies
        // existed rejects unknown fields, and the newer one treats absent as
        // default anyway — so sending nothing is both safer and cheaper.
        expect(compilePolicy(null)).toBeNull()
    })

    test("lenses are always emitted, even when empty", () => {
        // The analyser distinguishes absent ("caller knows nothing about lenses"
        // → today's reviewer) from empty ("all optional lenses off"). Only an
        // explicit key preserves that through JSON.
        const wire = compilePolicy(profile({ lenses: [] }))
        expect(wire).not.toBeNull()
        expect(wire!.lenses).toEqual([])
        expect(Object.keys(wire!)).toContain("lenses")
    })

    test("empty free text is omitted rather than sent blank", () => {
        const wire = compilePolicy(profile())!
        expect(wire.instructions).toBeUndefined()
        expect(wire.path_rules).toBeUndefined()
    })

    test("free text is carried when present", () => {
        const wire = compilePolicy(
            profile({ instructions: "wrap errors", path_rules: [{ glob: "*.sql", text: "note the rollback" }] }),
        )!
        expect(wire.instructions).toBe("wrap errors")
        expect(wire.path_rules).toEqual([{ glob: "*.sql", text: "note the rollback" }])
    })

    test("depth is clamped by the plan, not refused", () => {
        // A team that downgrades should get shallower reviews, not none.
        const wire = compilePolicy(profile({ dials: { ...DEFAULT_DIALS, depth: "deep" } }), { maxDepth: "quick" })!
        expect(wire.depth).toBe("quick")
    })

    test("clamping only ever lowers", () => {
        expect(clampDepth("quick", "deep")).toBe("quick")
        expect(clampDepth("deep", "deep")).toBe("deep")
        expect(clampDepth("deep", undefined)).toBe("deep")
        expect(clampDepth("deep", "standard")).toBe("standard")
    })

    test("only the depth dial is touched by the plan", () => {
        // Depth is the one dial that costs money, so it is the only one a billing
        // tier has any business changing.
        const p = profile({ dials: { ...DEFAULT_DIALS, strictness: "thorough", blocking: "bugs_only", depth: "deep" } })
        const wire = compilePolicy(p, { maxDepth: "quick" })!
        expect(wire.strictness).toBe("thorough")
        expect(wire.blocking).toBe("bugs_only")
        expect(wire.depth).toBe("quick")
    })
})

describe("merge-gate awareness", () => {
    test("the default does not touch the merge gate", () => {
        expect(affectsMergeGate(DEFAULT_DIALS)).toBe(false)
    })

    test("loosening what may block is flagged", () => {
        // MergeGate.ts refuses an in-app merge while blockers exist, so these two
        // dials change who may merge what. The UI has to say so.
        expect(affectsMergeGate({ ...DEFAULT_DIALS, blocking: "bugs_only" })).toBe(true)
        expect(affectsMergeGate({ ...DEFAULT_DIALS, evidence: "strict" })).toBe(true)
    })

    test("dials that only change wording are not flagged", () => {
        expect(affectsMergeGate({ ...DEFAULT_DIALS, voice: "coaching", verbosity: "terse" })).toBe(false)
    })
})

describe("presets", () => {
    test("balanced is exactly the default reviewer", () => {
        // The property that makes adopting profiles a no-op for anyone who just
        // picks the first option.
        const balanced = presetByKey("balanced")!
        expect(balanced.dials).toEqual(DEFAULT_DIALS)
        expect(balanced.lenses).toEqual(DEFAULT_LENSES)
    })

    test("an untouched preset is recognised as itself", () => {
        for (const p of PRESETS) {
            expect(matchingPreset(p.dials, parseLenses(p.lenses))?.key).toBe(p.key)
        }
    })

    test("a tuned profile reads as custom", () => {
        const balanced = presetByKey("balanced")!
        expect(matchingPreset({ ...balanced.dials, voice: "coaching" }, balanced.lenses)).toBeNull()
        expect(matchingPreset(balanced.dials, [...balanced.lenses, "security"])).toBeNull()
    })

    test("preset keys are unique", () => {
        expect(new Set(PRESETS.map((p) => p.key)).size).toBe(PRESETS.length)
    })
})

describe("depth by plan", () => {
    test("the free tier cannot ask for a deep review", () => {
        expect(maxDepthForTier("kit")).toBe("quick")
        const wire = compilePolicy(profile({ dials: { ...DEFAULT_DIALS, depth: "deep" } }), {
            maxDepth: maxDepthForTier("kit"),
        })!
        expect(wire.depth).toBe("quick")
    })

    test("a paid tier gets what it asked for", () => {
        const p = profile({ dials: { ...DEFAULT_DIALS, depth: "deep" } })
        expect(compilePolicy(p, { maxDepth: maxDepthForTier("pride") })!.depth).toBe("deep")
        expect(compilePolicy(p, { maxDepth: maxDepthForTier("apex") })!.depth).toBe("deep")
    })

    test("the cap never RAISES a shallow choice", () => {
        // A team on Apex that chose "quick" wants quick.
        const p = profile({ dials: { ...DEFAULT_DIALS, depth: "quick" } })
        expect(compilePolicy(p, { maxDepth: maxDepthForTier("apex") })!.depth).toBe("quick")
    })

    test("an unknown or missing tier folds to the floor", () => {
        // Matches Tier.of(), which folds an unrecognised id to Kit.
        for (const junk of [null, undefined, "", "enterprise_plus"]) {
            expect(maxDepthForTier(junk)).toBe("quick")
        }
    })
})

describe("the tier vocabulary cannot drift", () => {
    test("every billing tier has a depth cap", async () => {
        // ReviewProfile.ts keys this by plain string so it stays dependency-free
        // for the browser. Nothing imports across the boundary at runtime, so
        // THIS is what stops a fifth tier being added to the ladder and silently
        // falling to the floor for every team on it.
        const { TIER_IDS } = await import("@/modules/billing/domain/Tier")
        const floors = TIER_IDS.map((id) => maxDepthForTier(id))
        expect(floors).not.toContain(undefined)
        // Kit is the only tier that should land on the floor by design; any other
        // tier reading "quick" means it was forgotten rather than decided.
        const onFloor = TIER_IDS.filter((id) => maxDepthForTier(id) === "quick")
        expect(onFloor).toEqual(["kit"])
    })

    test("the ladder is monotonic — a higher plan never buys less depth", () => {
        const rank = { quick: 0, standard: 1, deep: 2 } as const
        const ladder = ["kit", "prowler", "pride", "apex"].map((t) => rank[maxDepthForTier(t)])
        for (let i = 1; i < ladder.length; i++) {
            expect(ladder[i]).toBeGreaterThanOrEqual(ladder[i - 1])
        }
    })
})
