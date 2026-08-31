import { describe, it, expect } from "bun:test"
import { AnalysisBranch } from "./AnalysisBranch"

describe("AnalysisBranch.normalise", () => {
    it("keeps a slashed branch name, which is most of them", () => {
        expect(AnalysisBranch.normalise("feat/multi-branch")).toBe("feat/multi-branch")
    })

    it("trims the edges", () => {
        expect(AnalysisBranch.normalise("  develop\n")).toBe("develop")
    })

    // The name becomes part of a graph key. A name with a space in it addresses
    // a graph that cannot exist, and the database rejects it too — so the route
    // has to hear about it here, not from a constraint violation.
    it("refuses a name with whitespace inside it", () => {
        expect(AnalysisBranch.normalise("feat/ x")).toBeNull()
    })

    // Null is "the default tree", not a failure: an untagged issue is the norm.
    it("reads empty and non-strings as the default tree", () => {
        for (const input of ["", "   ", null, undefined, 7, {}]) {
            expect(AnalysisBranch.normalise(input)).toBeNull()
        }
    })
})

describe("AnalysisBranch.answerable", () => {
    it("sends a ready branch", () => {
        expect(AnalysisBranch.answerable({ branch: "feat/x", status: "ready" })).toBe("feat/x")
    })

    // The analyser refuses a branch it hasn't indexed. Asking for one mid-index
    // buys an error; the default tree is a worse answer than the branch's but a
    // far better one than none.
    it("falls back to the default for a branch that cannot answer yet", () => {
        for (const status of ["pending", "indexing", "failed"]) {
            expect(AnalysisBranch.answerable({ branch: "feat/x", status })).toBeUndefined()
        }
    })

    it("falls back to the default for a branch nobody tracks", () => {
        expect(AnalysisBranch.answerable(null)).toBeUndefined()
        expect(AnalysisBranch.answerable(undefined)).toBeUndefined()
    })
})
