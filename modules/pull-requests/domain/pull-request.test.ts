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
})
