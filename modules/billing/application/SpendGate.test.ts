// The hard gate. Each case is either "a paused team spent money" or "a working
// team was blocked", so both directions are pinned.

import { test, expect, describe, mock, beforeEach } from "bun:test"
import { SpendGate } from "./SpendGate"

const subjects = { findForTeam: mock() }
const subscriptions = { findByTeam: mock() }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const gate = () => new SpendGate(subjects as any, subscriptions as any)

const subject = (status: "active" | "suspended") => ({ id: "s1", slot: "free", status, boundTeamId: "t1" })
const sub = (status: string) => ({ team_id: "t1", tier: "kit", monthly_points: null, period_start: "", status })

beforeEach(() => {
    subjects.findForTeam.mockReset().mockResolvedValue(subject("active"))
    subscriptions.findByTeam.mockReset().mockResolvedValue(sub("active"))
})

describe("check", () => {
    test("an active team may spend", async () => {
        expect(await gate().check("t1")).toBeNull()
    })

    test("a suspended SUBJECT blocks spending", async () => {
        subjects.findForTeam.mockResolvedValue(subject("suspended"))
        expect((await gate().check("t1"))?.reason).toBe("suspended")
    })

    test("a suspended SUBSCRIPTION blocks spending too — either side of the pair "
        + "may be the one written last", async () => {
        subscriptions.findByTeam.mockResolvedValue(sub("suspended"))
        expect((await gate().check("t1"))?.reason).toBe("suspended")
    })

    test("a team with no subject yet (pre-0076, awaiting backfill) may spend — "
        + "refusing would stop the app for every existing team", async () => {
        subjects.findForTeam.mockResolvedValue(null)
        subscriptions.findByTeam.mockResolvedValue(null)
        expect(await gate().check("t1")).toBeNull()
    })

    test("the refusal explains the way out, since a pause is self-inflicted and "
        + "self-fixable", async () => {
        subjects.findForTeam.mockResolvedValue(subject("suspended"))
        const refusal = await gate().check("t1")
        expect(refusal?.message).toContain("Resume")
    })

    test("a read failure propagates — the caller fails closed rather than "
        + "treating an unreadable subject as permission to spend", async () => {
        subjects.findForTeam.mockRejectedValue(new Error("db down"))
        expect(gate().check("t1")).rejects.toThrow()
    })
})
