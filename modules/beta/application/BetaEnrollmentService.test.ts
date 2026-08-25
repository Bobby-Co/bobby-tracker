// DI tests for BetaEnrollmentService — the admission decision.
//
// Both dependencies are constructor-injected ports, so these are plain mocks. The
// branches pinned here are the ones with real consequences: the stamp is the only
// thing the browser gate can see, so admitting without stamping strands a user on
// the waitlist, and stamping without a hit lets an uninvited one in.

import { test, expect, describe, mock, beforeEach } from "bun:test"
import { BetaEnrollmentService } from "./BetaEnrollmentService"

const allowlist = { find: mock(), list: mock(), add: mock(), remove: mock(), markGranted: mock() }
const stamp = { grant: mock(), revoke: mock() }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const svc = () => new BetaEnrollmentService(allowlist as any, stamp as any)

const entry = (email: string) => ({
    email, invited_by: null, note: null, created_at: "", granted_at: null, granted_user: null,
})

beforeEach(() => {
    allowlist.find.mockReset().mockResolvedValue(null)
    allowlist.list.mockReset().mockResolvedValue([])
    allowlist.add.mockReset().mockImplementation(async (e: { value: string }) => entry(e.value))
    allowlist.remove.mockReset().mockResolvedValue(true)
    allowlist.markGranted.mockReset().mockResolvedValue(undefined)
    stamp.grant.mockReset().mockResolvedValue(undefined)
    stamp.revoke.mockReset().mockResolvedValue(undefined)
})

describe("admit", () => {
    test("an invited address is admitted AND stamped", async () => {
        allowlist.find.mockResolvedValue(entry("ada@example.com"))
        expect(await svc().admit({ id: "u1", email: "ada@example.com", stamped: false })).toBe(true)
        expect(stamp.grant).toHaveBeenCalledWith("u1")
    })

    test("an uninvited address is refused and never stamped", async () => {
        expect(await svc().admit({ id: "u1", email: "nobody@example.com", stamped: false })).toBe(false)
        expect(stamp.grant).not.toHaveBeenCalled()
    })

    test("an already-stamped user costs no query", async () => {
        expect(await svc().admit({ id: "u1", email: "ada@example.com", stamped: true })).toBe(true)
        expect(allowlist.find).not.toHaveBeenCalled()
    })

    test("the address is normalised before the lookup — a provider reporting "
        + "Mixed Case must still match the stored row", async () => {
        allowlist.find.mockResolvedValue(entry("ada@example.com"))
        await svc().admit({ id: "u1", email: "  Ada@Example.COM ", stamped: false })
        expect(allowlist.find.mock.calls[0][0].value).toBe("ada@example.com")
    })

    test("no email (or a junk one) → refused, no lookup", async () => {
        expect(await svc().admit({ id: "u1", email: null, stamped: false })).toBe(false)
        expect(await svc().admit({ id: "u1", email: "not-an-address", stamped: false })).toBe(false)
        expect(allowlist.find).not.toHaveBeenCalled()
    })

    test("a failed audit write does NOT undo an admission", async () => {
        allowlist.find.mockResolvedValue(entry("ada@example.com"))
        allowlist.markGranted.mockRejectedValue(new Error("db down"))
        expect(await svc().admit({ id: "u1", email: "ada@example.com", stamped: false })).toBe(true)
    })

    test("a failed STAMP fails the admission — the caller must not report "
        + "success for a flag that never landed", async () => {
        allowlist.find.mockResolvedValue(entry("ada@example.com"))
        stamp.grant.mockRejectedValue(new Error("auth admin down"))
        expect(svc().admit({ id: "u1", email: "ada@example.com", stamped: false })).rejects.toThrow()
    })

    test("a lookup failure propagates rather than reading as 'not invited'", async () => {
        allowlist.find.mockRejectedValue(new Error("db down"))
        expect(svc().admit({ id: "u1", email: "ada@example.com", stamped: false })).rejects.toThrow()
    })
})

describe("enroll / revoke", () => {
    test("enrolling normalises the address", async () => {
        await svc().enroll("  Ada@Example.COM ", { note: "design partner" })
        expect(allowlist.add.mock.calls[0][0].value).toBe("ada@example.com")
        expect(allowlist.add.mock.calls[0][1]).toEqual({ note: "design partner" })
    })

    test("a malformed address is null (a 400), not a silent write", async () => {
        expect(await svc().enroll("not-an-address")).toBeNull()
        expect(allowlist.add).not.toHaveBeenCalled()
    })

    test("revoke removes the INVITATION and leaves the stamp alone — evicting "
        + "an admitted user is revokeUser's job", async () => {
        expect(await svc().revoke("ada@example.com")).toBe(true)
        expect(stamp.revoke).not.toHaveBeenCalled()
        await svc().revokeUser("u1")
        expect(stamp.revoke).toHaveBeenCalledWith("u1")
    })
})
