import { test, expect, describe } from "bun:test"
import { PullRequest } from "./pull-request"

const pr = (over: Partial<Parameters<typeof PullRequest.of>[0]> = {}) =>
    PullRequest.of({ merged: false, state: "open", draft: false, ...over })

describe("PullRequest lifecycle", () => {
    test("isClosed = merged OR closed-without-merge", () => {
        expect(pr({ merged: true }).isClosed()).toBe(true)
        expect(pr({ state: "closed" }).isClosed()).toBe(true)
        expect(pr().isClosed()).toBe(false)
        expect(pr({ draft: true }).isClosed()).toBe(false) // a draft is still open
    })
    test("isOpen is the inverse of isClosed", () => {
        expect(pr().isOpen()).toBe(true)
        expect(pr({ merged: true }).isOpen()).toBe(false)
    })
    test("lifecycle label follows priority merged > closed > draft > open", () => {
        expect(pr({ merged: true, state: "closed", draft: true }).lifecycle()).toBe("merged")
        expect(pr({ state: "closed", draft: true }).lifecycle()).toBe("closed")
        expect(pr({ draft: true }).lifecycle()).toBe("draft")
        expect(pr().lifecycle()).toBe("open")
    })
    test("isMerged / isDraft read their flags directly", () => {
        expect(pr({ merged: true }).isMerged()).toBe(true)
        expect(pr().isMerged()).toBe(false)
        expect(pr({ draft: true }).isDraft()).toBe(true)
        expect(pr().isDraft()).toBe(false)
    })
    test("a merged PR whose state is still 'open' is closed for the tracker", () => {
        // GitHub can report merged:true with state:'open' briefly; the tracker
        // treats merged as terminal regardless of the raw state field.
        expect(pr({ merged: true, state: "open" }).isClosed()).toBe(true)
        expect(pr({ merged: true, state: "open" }).lifecycle()).toBe("merged")
    })
    test("lifecycle label agrees with isClosed for every flag combination", () => {
        for (const merged of [false, true]) {
            for (const state of ["open", "closed"] as const) {
                for (const draft of [false, true]) {
                    const p = pr({ merged, state, draft })
                    const closedByLabel = p.lifecycle() === "merged" || p.lifecycle() === "closed"
                    expect(p.isClosed()).toBe(closedByLabel)
                }
            }
        }
    })
})
