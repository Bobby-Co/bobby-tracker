// The hard gate. Each case is either "a team that should have been stopped spent
// money" or "a working team was blocked", so both directions are pinned.

import { test, expect, describe, mock, beforeEach } from "bun:test"
import { SpendGate } from "./SpendGate"
import { Balance } from "../domain/Balance"

const subjects = { findForTeam: mock() }
const subscriptions = { findByTeam: mock() }
const periodUsage = { forSubject: mock() }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const gate = () => new SpendGate(subjects as any, subscriptions as any, periodUsage as any)

const subject = (status: "active" | "suspended") => ({ id: "s1", slot: "free", status, boundTeamId: "t1" })
const sub = (
    status: string,
    over: Partial<{ tier: string; monthly_points: number | null; current_period_start: string }> = {},
) => ({
    team_id: "t1",
    tier: "kit",
    monthly_points: null,
    // Deliberately STALE: this is what the column actually looks like in
    // production, having been written once at team creation and never
    // advanced. Nothing may read it.
    period_start: "2026-01-01T00:00:00.000Z",
    // Free teams have no billed window; the calendar month stands in.
    current_period_start: null,
    status,
    ...over,
})
/** Kit's allowance is 2,000 points; `points` is what the rollup reports spent. */
const spent = (points: number) => ({ points, costUsd: points / 1000, calls: 1 })

beforeEach(() => {
    subjects.findForTeam.mockReset().mockResolvedValue(subject("active"))
    subscriptions.findByTeam.mockReset().mockResolvedValue(sub("active"))
    periodUsage.forSubject.mockReset().mockResolvedValue(spent(0))
})

describe("suspension", () => {
    test("an active team with credits left may spend", async () => {
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

    test("a team with no subject yet (pre-0076, awaiting backfill) is not treated "
        + "as paused — refusing would stop the app for every existing team", async () => {
        subjects.findForTeam.mockResolvedValue(null)
        subscriptions.findByTeam.mockResolvedValue(null)
        expect(await gate().check("t1")).toBeNull()
    })

    test("the refusal explains the way out, since a pause is self-inflicted and "
        + "self-fixable", async () => {
        subjects.findForTeam.mockResolvedValue(subject("suspended"))
        expect((await gate().check("t1"))?.message).toContain("Resume")
    })

    test("suspension short-circuits the balance read — a paused team is refused "
        + "whatever it has left, so the round trip could only confirm it", async () => {
        subjects.findForTeam.mockResolvedValue(subject("suspended"))
        await gate().check("t1")
        expect(periodUsage.forSubject).not.toHaveBeenCalled()
    })
})

describe("the monthly allowance", () => {
    test("under the allowance, spending continues", async () => {
        periodUsage.forSubject.mockResolvedValue(spent(1_999))
        expect(await gate().check("t1")).toBeNull()
    })

    test("spending the allowance EXACTLY is exhausted — the last point is spent, "
        + "not still available", async () => {
        periodUsage.forSubject.mockResolvedValue(spent(2_000))
        expect((await gate().check("t1"))?.reason).toBe("exhausted")
    })

    test("overshooting (the period's last call landed over the line) stays "
        + "refused rather than wrapping to a fresh allowance", async () => {
        periodUsage.forSubject.mockResolvedValue(spent(9_999_999))
        expect((await gate().check("t1"))?.reason).toBe("exhausted")
    })

    test("the refusal names both ways out — waiting for the reset and upgrading — "
        + "because unlike a pause the team may not be able to fix it now", async () => {
        periodUsage.forSubject.mockResolvedValue(spent(2_000))
        const message = (await gate().check("t1"))?.message ?? ""
        expect(message).toContain("2,000")
        expect(message).toContain("reset")
        expect(message).toContain("upgrade")
    })

    test("a SUBSCRIBED team is metered over the window it is being billed for, "
        + "not the calendar month — since billing renews on the purchase date, a "
        + "period straddles two months, and metering by month would charge a team "
        + "for a window it is not paying for", async () => {
        subscriptions.findByTeam.mockResolvedValue(
            sub("active", { current_period_start: "2026-08-14T00:00:00.000Z" }),
        )
        await gate().check("t1")
        expect(periodUsage.forSubject).toHaveBeenCalledWith(
            subject("active"),
            "t1",
            "2026-08-14T00:00:00.000Z",
        )
    })

    test("the balance is read for the CURRENT calendar month, never the anchor "
        + "stored on the subscription — that column was written once at team "
        + "creation and advanced by nothing, so reading it froze every balance "
        + "at month one and silently stopped this gate firing", async () => {
        subscriptions.findByTeam.mockResolvedValue(sub("active", {}))
        await gate().check("t1")
        expect(periodUsage.forSubject).toHaveBeenCalledWith(
            subject("active"),
            "t1",
            Balance.currentPeriodStart(),
        )
    })

    test("a higher tier gets its own, larger allowance", async () => {
        subscriptions.findByTeam.mockResolvedValue(sub("active", { tier: "prowler" }))
        periodUsage.forSubject.mockResolvedValue(spent(2_500))
        expect(await gate().check("t1")).toBeNull()
    })

    test("a negotiated per-team override beats the tier default", async () => {
        subscriptions.findByTeam.mockResolvedValue(sub("active", { monthly_points: 500 }))
        periodUsage.forSubject.mockResolvedValue(spent(600))
        expect((await gate().check("t1"))?.reason).toBe("exhausted")
    })

    test("an UNCAPPED tier is never exhausted, and its balance is never even "
        + "read — the answer cannot depend on it", async () => {
        subscriptions.findByTeam.mockResolvedValue(sub("active", { tier: "apex" }))
        expect(await gate().check("t1")).toBeNull()
        expect(periodUsage.forSubject).not.toHaveBeenCalled()
    })

    test("a team with NO subscription row is held to the Kit floor — a missing "
        + "row must not read as permission to spend without limit", async () => {
        subscriptions.findByTeam.mockResolvedValue(null)
        periodUsage.forSubject.mockResolvedValue(spent(2_000))
        expect((await gate().check("t1"))?.reason).toBe("exhausted")
    })

    test("a team with no SUBJECT is still balance-checked, against its own rollup "
        + "— the backfill gap excuses a missing identity, not a missing limit", async () => {
        subjects.findForTeam.mockResolvedValue(null)
        periodUsage.forSubject.mockResolvedValue(spent(2_000))
        const refusal = await gate().check("t1")
        expect(refusal?.reason).toBe("exhausted")
        expect(periodUsage.forSubject).toHaveBeenCalledWith(null, "t1", "2026-08-01T00:00:00.000Z")
    })
})

describe("an unpaid plan", () => {
    test("is held to the FREE allowance, not the one it bought — the month it did "
        + "not pay for is a month whose credits were never granted", async () => {
        subscriptions.findByTeam.mockResolvedValue(sub("past_due", { tier: "prowler" }))
        // Well under Prowler's 40,000, but over Kit's 2,000.
        periodUsage.forSubject.mockResolvedValue(spent(2_500))
        expect((await gate().check("t1"))?.reason).toBe("exhausted")
    })

    test("...and still gets that free allowance, rather than being cut off — an "
        + "expired card should cost a team its paid credits, not its access", async () => {
        subscriptions.findByTeam.mockResolvedValue(sub("past_due", { tier: "prowler" }))
        periodUsage.forSubject.mockResolvedValue(spent(500))
        expect(await gate().check("t1")).toBeNull()
    })

    test("a negotiated override does NOT survive going past due — it belongs to "
        + "the plan, and the plan is not being paid for", async () => {
        subscriptions.findByTeam.mockResolvedValue(sub("past_due", { tier: "apex", monthly_points: 500_000 }))
        periodUsage.forSubject.mockResolvedValue(spent(2_000))
        expect((await gate().check("t1"))?.reason).toBe("exhausted")
    })

    test("an UNCAPPED plan that is past due is no longer uncapped — it is on the "
        + "free tier like any other unpaid team", async () => {
        subscriptions.findByTeam.mockResolvedValue(sub("past_due", { tier: "apex" }))
        periodUsage.forSubject.mockResolvedValue(spent(2_000))
        expect((await gate().check("t1"))?.reason).toBe("exhausted")
    })
})

describe("failing closed", () => {
    test("a subject read failure propagates — the caller fails closed rather than "
        + "treating an unreadable subject as permission to spend", async () => {
        subjects.findForTeam.mockRejectedValue(new Error("db down"))
        expect(gate().check("t1")).rejects.toThrow()
    })

    test("a USAGE read failure propagates too — an unreadable balance is the one "
        + "case where guessing 'probably fine' hands out free credits", async () => {
        periodUsage.forSubject.mockRejectedValue(new Error("rollup unreachable"))
        expect(gate().check("t1")).rejects.toThrow()
    })
})
