import { test, expect, describe } from "bun:test"
import { PublicSession } from "./session"

const NOW = Date.parse("2026-07-20T12:00:00.000Z")
const at = (hoursFromNow: number) => new Date(NOW + hoursFromNow * 3_600_000).toISOString()

describe("PublicSession open window", () => {
    test("open when no window is set", () => {
        expect(PublicSession.of({}).isOpen(NOW)).toBe(true)
    })
    test("before-start: start in the future", () => {
        const s = PublicSession.of({ start_at: at(1) })
        expect(s.isBeforeStart(NOW)).toBe(true)
        expect(s.isOpen(NOW)).toBe(false)
    })
    test("after-end: end in the past (inclusive)", () => {
        expect(PublicSession.of({ end_at: at(-1) }).isAfterEnd(NOW)).toBe(true)
        expect(PublicSession.of({ end_at: at(0) }).isAfterEnd(NOW)).toBe(true) // <= now
        expect(PublicSession.of({ end_at: at(1) }).isAfterEnd(NOW)).toBe(false)
    })
    test("within the window is open", () => {
        expect(PublicSession.of({ start_at: at(-1), end_at: at(1) }).isOpen(NOW)).toBe(true)
    })
})

describe("PublicSession access + visibility", () => {
    test("link vs invite", () => {
        expect(PublicSession.of({ access_mode: "link" }).isLinkAccess()).toBe(true)
        expect(PublicSession.of({ access_mode: "link" }).isInviteOnly()).toBe(false)
        expect(PublicSession.of({ access_mode: "invite" }).isInviteOnly()).toBe(true)
    })
    test("own vs all submissions", () => {
        expect(PublicSession.of({ submissions_visibility: "own" }).showsOwnSubmissionsOnly()).toBe(true)
        expect(PublicSession.of({ submissions_visibility: "all" }).showsOwnSubmissionsOnly()).toBe(false)
    })
})
