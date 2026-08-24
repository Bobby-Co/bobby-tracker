// The burst bound. The cases that matter are the boundary (at the cap vs one
// below it) and the two ways it could silently stop bounding anything: an
// uncapped tier, and a read that fails.

import { test, expect, describe, mock, beforeEach } from "bun:test"
import { RunAdmission } from "./RunAdmission"

const allowance = { forTeam: mock() }
const runs = { countForTeam: mock(), listForTeam: mock() }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const admission = () => new RunAdmission(allowance as any, runs as any)

beforeEach(() => {
    allowance.forTeam.mockReset().mockResolvedValue(2)
    runs.countForTeam.mockReset().mockResolvedValue(0)
})

describe("check", () => {
    test("an idle team may start a run", async () => {
        expect(await admission().check("t1")).toBeNull()
    })

    test("one below the cap still admits — the cap counts runs already in "
        + "flight, not including the one being asked about", async () => {
        runs.countForTeam.mockResolvedValue(1)
        expect(await admission().check("t1")).toBeNull()
    })

    test("AT the cap refuses", async () => {
        runs.countForTeam.mockResolvedValue(2)
        expect((await admission().check("t1"))?.reason).toBe("too_many_runs")
    })

    test("over the cap stays refused — a team that overshot at a boundary is not "
        + "handed the difference back", async () => {
        runs.countForTeam.mockResolvedValue(50)
        expect((await admission().check("t1"))?.reason).toBe("too_many_runs")
    })

    test("the refusal says to WAIT first — unlike an exhausted balance this "
        + "clears on its own, so upgrading is the second suggestion, not the "
        + "only one", async () => {
        runs.countForTeam.mockResolvedValue(2)
        const message = (await admission().check("t1"))?.message ?? ""
        expect(message).toContain("Wait")
        expect(message).toContain("upgrade")
    })

    test("the message agrees with itself on plurals at a cap of one", async () => {
        allowance.forTeam.mockResolvedValue(1)
        runs.countForTeam.mockResolvedValue(1)
        expect((await admission().check("t1"))?.message).toContain("1 analysis running")
    })

    test("an UNCAPPED tier admits without counting — nothing the count could "
        + "say would refuse, so the query is not worth making", async () => {
        allowance.forTeam.mockResolvedValue(null)
        expect(await admission().check("t1")).toBeNull()
        expect(runs.countForTeam).not.toHaveBeenCalled()
    })
})

describe("failing closed", () => {
    test("an unreadable allowance propagates rather than admitting — the whole "
        + "point of the bound is that unbounded dispatch is the bad outcome", async () => {
        allowance.forTeam.mockRejectedValue(new Error("subscriptions down"))
        expect(admission().check("t1")).rejects.toThrow()
    })

    test("an uncountable set of runs propagates too — 'the count failed' is not "
        + "evidence that there are none", async () => {
        runs.countForTeam.mockRejectedValue(new Error("data plane unreachable"))
        expect(admission().check("t1")).rejects.toThrow()
    })
})
