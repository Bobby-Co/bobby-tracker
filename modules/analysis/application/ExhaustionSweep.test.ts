// Stopping work that is already running. The cases that matter: it sweeps only
// when the team may not spend, it keeps going when one cancel fails, and it does
// not quietly do nothing when the gate says stop.

import { test, expect, describe, mock, beforeEach } from "bun:test"
import { ExhaustionSweep } from "./ExhaustionSweep"

const spend = { check: mock() }
const runs = { countForTeam: mock(), listForTeam: mock() }
const canceller = { cancelIssue: mock(), cancelPr: mock() }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sweep = () => new ExhaustionSweep(spend as any, runs as any, canceller as any)

const issueRun = { kind: "issue" as const, taskId: "iss-1", projectId: "p1" }
const prRun = { kind: "pr" as const, taskId: "row-9", projectId: "p1", prNumber: 42 }

beforeEach(() => {
    spend.check.mockReset().mockResolvedValue(null)
    runs.listForTeam.mockReset().mockResolvedValue([issueRun, prRun])
    canceller.cancelIssue.mockReset().mockResolvedValue(undefined)
    canceller.cancelPr.mockReset().mockResolvedValue(undefined)
})

describe("sweep", () => {
    test("a team that may still spend is left alone — the trigger fires on every "
        + "rollup write, so this is the common path and it must be cheap", async () => {
        expect(await sweep().sweep("t1")).toEqual({ reason: null, cancelled: 0, failed: 0 })
        expect(runs.listForTeam).not.toHaveBeenCalled()
        expect(canceller.cancelIssue).not.toHaveBeenCalled()
    })

    test("an EXHAUSTED team has every in-flight run cancelled", async () => {
        spend.check.mockResolvedValue({ reason: "exhausted", message: "out" })
        expect(await sweep().sweep("t1")).toEqual({ reason: "exhausted", cancelled: 2, failed: 0 })
        expect(canceller.cancelIssue).toHaveBeenCalledWith("iss-1")
        expect(canceller.cancelPr).toHaveBeenCalledWith("p1", 42)
    })

    test("a SUSPENDED team is swept by the same pass — pausing a team used to "
        + "leave its running work to finish and bill", async () => {
        spend.check.mockResolvedValue({ reason: "suspended", message: "paused" })
        expect((await sweep().sweep("t1")).cancelled).toBe(2)
    })

    test("one failing cancel does not abandon the rest — the whole point is to "
        + "stop ALL of them, and the analyser's cancel is best-effort anyway", async () => {
        spend.check.mockResolvedValue({ reason: "exhausted", message: "out" })
        canceller.cancelIssue.mockRejectedValue(new Error("cell unreachable"))
        expect(await sweep().sweep("t1")).toEqual({ reason: "exhausted", cancelled: 1, failed: 1 })
        expect(canceller.cancelPr).toHaveBeenCalled()
    })

    test("a PR row with no number is skipped rather than guessed at", async () => {
        spend.check.mockResolvedValue({ reason: "exhausted", message: "out" })
        runs.listForTeam.mockResolvedValue([{ kind: "pr", taskId: "row-9", projectId: "p1" }])
        await sweep().sweep("t1")
        expect(canceller.cancelPr).not.toHaveBeenCalled()
    })

    test("nothing in flight is a clean no-op, not an error", async () => {
        spend.check.mockResolvedValue({ reason: "exhausted", message: "out" })
        runs.listForTeam.mockResolvedValue([])
        expect(await sweep().sweep("t1")).toEqual({ reason: "exhausted", cancelled: 0, failed: 0 })
    })

    test("an unreadable balance propagates — a sweep that swallowed the error "
        + "would report success while cancelling nothing", async () => {
        spend.check.mockRejectedValue(new Error("db down"))
        expect(sweep().sweep("t1")).rejects.toThrow()
    })
})
