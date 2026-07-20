import { test, expect } from "bun:test"
import { findingState } from "./finding-severity"

test("findingState — critical vocabulary blocks, legacy 'bug' still blocks", () => {
    expect(findingState("critical")).toBe("critical")
    expect(findingState("bug")).toBe("critical")
})

test("findingState — 'good' is good", () => {
    expect(findingState("good")).toBe("good")
})

test("findingState — everything else is 'review' (risk/style/nit/unknown)", () => {
    for (const s of ["review", "risk", "style", "nit", "", "anything"]) {
        expect(findingState(s)).toBe("review")
    }
})
