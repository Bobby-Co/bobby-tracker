import { test, expect, describe } from "bun:test"
import { branchChoicePending } from "./issue-branch-choice"
import { defaultBranchLabel } from "@/components/projects/branch-picker"
import type { ProjectBranch } from "@/lib/shared/types"

const branch = (name: string) => ({ branch: name }) as ProjectBranch

// The submit gate and the control read the same rule from this function, so a
// disagreement between them is impossible by construction. What it must get
// right is the difference between the three states of the field.
describe("branchChoicePending", () => {
    test("a project with a real choice blocks until one is made", () => {
        expect(branchChoicePending([branch("feat/x")], null)).toBe(true)
    })

    // "" is the author ANSWERING "the default branch" — a made decision, not an
    // absent one. Treating it as unchosen would make the default unpickable.
    test("explicitly choosing the default branch satisfies it", () => {
        expect(branchChoicePending([branch("feat/x")], "")).toBe(false)
    })

    test("choosing a branch satisfies it", () => {
        expect(branchChoicePending([branch("feat/x")], "feat/x")).toBe(false)
    })

    // A project that tracks nothing has exactly one tree. There is no choice to
    // make and nothing to learn from being asked, so composition is never
    // blocked — this is what keeps the requirement from breaking every project
    // that has never heard of branches.
    test("a project with no indexed branches never blocks", () => {
        expect(branchChoicePending([], null)).toBe(false)
    })
})

// Naming the default is the difference between choosing "the default one" and
// choosing between `main` and `feat/x`. The generic word stays either way,
// because the bare name does not say that it IS the default.
describe("defaultBranchLabel", () => {
    test("names the default branch when it is known", () => {
        expect(defaultBranchLabel("main")).toBe("Default branch (main)")
        expect(defaultBranchLabel("develop")).toBe("Default branch (develop)")
    })

    // Null is "not learned yet" (0095) — every project looked like this before
    // the name was mirrored, and a project nobody pushes to still does.
    test("falls back to the bare word when it is not", () => {
        expect(defaultBranchLabel(null)).toBe("Default branch")
    })
})
