// What a team has spent this period — and, crucially, WHOSE spend counts.
//
// The reason this class exists is that the answer is not "the team's rows". It
// is the billing SUBJECT's rows, summed across every team that subject has ever
// been bound to, including deleted ones. That distinction is the whole of 0076:
// without it, deleting a team and making another one is a free allowance reset.

import { test, expect, describe, mock, beforeEach } from "bun:test"
import { PeriodUsageReader } from "./PeriodUsageReader"

const subjects = { findForTeam: mock(), teamIdsFor: mock() }
const usage = { currentPeriodUsage: mock(), subjectPeriodUsage: mock() }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const reader = () => new PeriodUsageReader(subjects as any, usage as any)

const PERIOD = "2026-08-01T00:00:00.000Z"
const facts = { id: "s1", slot: "free" as const, status: "active" as const, boundTeamId: "t2" }

beforeEach(() => {
    subjects.findForTeam.mockReset().mockResolvedValue(facts)
    subjects.teamIdsFor.mockReset().mockResolvedValue(["t1", "t2"])
    usage.currentPeriodUsage.mockReset().mockResolvedValue({ points: 7, costUsd: 0.007, calls: 1 })
    usage.subjectPeriodUsage.mockReset().mockResolvedValue({ points: 99, costUsd: 0.099, calls: 4 })
})

describe("forTeam", () => {
    test("reads across every team the subject has spent through — including the "
        + "deleted one it is no longer bound to", async () => {
        expect(await reader().forTeam("t2", PERIOD)).toEqual({ points: 99, costUsd: 0.099, calls: 4 })
        expect(usage.subjectPeriodUsage).toHaveBeenCalledWith(["t1", "t2"], PERIOD)
        expect(usage.currentPeriodUsage).not.toHaveBeenCalled()
    })

    test("a team with no subject falls back to its OWN rollup — the pre-0076 "
        + "backfill gap must not read as zero spend", async () => {
        subjects.findForTeam.mockResolvedValue(null)
        expect((await reader().forTeam("t2", PERIOD)).points).toBe(7)
        expect(usage.currentPeriodUsage).toHaveBeenCalledWith("t2", PERIOD)
    })
})

describe("forSubject", () => {
    test("takes a subject the caller already resolved and skips the lookup — the "
        + "gate reads it anyway, and this is the hot path of every billable call", async () => {
        expect(await reader().forSubject(facts, "t2", PERIOD)).toEqual({ points: 99, costUsd: 0.099, calls: 4 })
        expect(subjects.findForTeam).not.toHaveBeenCalled()
    })

    test("answers identically to forTeam — one definition of a balance, so the "
        + "pill and the gate cannot disagree", async () => {
        expect(await reader().forSubject(facts, "t2", PERIOD)).toEqual(await reader().forTeam("t2", PERIOD))
    })
})
