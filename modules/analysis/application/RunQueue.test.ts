// Draining the queue. The properties that matter: it never starts more than the
// free slots, it re-checks the balance before spending anything, and one bad row
// does not strand the rest.

import { test, expect, describe, mock, beforeEach } from "bun:test"
import { RunQueue } from "./RunQueue"

const spend = { check: mock() }
const allowance = { forTeam: mock() }
const runs = { countForTeam: mock(), listForTeam: mock(), listQueuedForTeam: mock() }
const projects = { findTeamId: mock() }
const dispatch = { startIssue: mock(), startPr: mock() }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const queue = () => new RunQueue(spend as any, allowance as any, runs as any, projects as any, dispatch as any)

const issueRun = { kind: "issue" as const, taskId: "iss-1", projectId: "p1" }
const prRun = { kind: "pr" as const, taskId: "row-9", projectId: "p1", prNumber: 42 }

beforeEach(() => {
    spend.check.mockReset().mockResolvedValue(null)
    allowance.forTeam.mockReset().mockResolvedValue(2)
    runs.countForTeam.mockReset().mockResolvedValue(0)
    runs.listQueuedForTeam.mockReset().mockResolvedValue([issueRun])
    projects.findTeamId.mockReset().mockResolvedValue("t1")
    dispatch.startIssue.mockReset().mockResolvedValue(undefined)
    dispatch.startPr.mockReset().mockResolvedValue(undefined)
})

describe("drain", () => {
    test("starts a queued issue when a slot is free", async () => {
        expect(await queue().drain("t1", "https://app")).toEqual({ blocked: null, started: 1 })
        expect(dispatch.startIssue).toHaveBeenCalledWith("iss-1", "https://app")
    })

    test("a queued PR review is restarted by (project, number), not by task id — "
        + "the head may have moved while it waited", async () => {
        runs.listQueuedForTeam.mockResolvedValue([prRun])
        await queue().drain("t1", "https://app")
        expect(dispatch.startPr).toHaveBeenCalledWith("p1", 42, "https://app")
    })

    test("asks for exactly the number of FREE slots, never the whole queue", async () => {
        allowance.forTeam.mockResolvedValue(5)
        runs.countForTeam.mockResolvedValue(3)
        await queue().drain("t1", "https://app")
        expect(runs.listQueuedForTeam).toHaveBeenCalledWith("t1", 2)
    })

    test("a full team starts nothing and does not even read the queue", async () => {
        runs.countForTeam.mockResolvedValue(2)
        expect(await queue().drain("t1", "https://app")).toEqual({ blocked: "at_capacity", started: 0 })
        expect(runs.listQueuedForTeam).not.toHaveBeenCalled()
    })

    test("an EXHAUSTED team drains nothing — this re-check is what makes queueing "
        + "safer than the refusal it replaced: a burst queued against the last "
        + "credits dies here instead of running", async () => {
        spend.check.mockResolvedValue({ reason: "exhausted", message: "out" })
        expect(await queue().drain("t1", "https://app")).toEqual({ blocked: "exhausted", started: 0 })
        expect(dispatch.startIssue).not.toHaveBeenCalled()
    })

    test("...and the work stays QUEUED rather than being discarded — the allowance "
        + "resets, and 'still waiting' is the honest answer until it does", async () => {
        spend.check.mockResolvedValue({ reason: "exhausted", message: "out" })
        await queue().drain("t1", "https://app")
        // Nothing was read or rewritten: the rows keep their 'queued' status.
        expect(runs.listQueuedForTeam).not.toHaveBeenCalled()
    })

    test("one run that fails to start does not strand the ones behind it", async () => {
        runs.listQueuedForTeam.mockResolvedValue([issueRun, prRun])
        dispatch.startIssue.mockRejectedValue(new Error("cell unreachable"))
        expect((await queue().drain("t1", "https://app")).started).toBe(1)
        expect(dispatch.startPr).toHaveBeenCalled()
    })

    test("an uncapped team drains in bounded batches — nothing should be queued "
        + "for it at all, so anything found is residue from a smaller plan and "
        + "releasing it all at once would be its own stampede", async () => {
        allowance.forTeam.mockResolvedValue(null)
        await queue().drain("t1", "https://app")
        expect(runs.listQueuedForTeam).toHaveBeenCalledWith("t1", 8)
        expect(runs.countForTeam).not.toHaveBeenCalled()
    })

    test("an empty queue is a clean no-op", async () => {
        runs.listQueuedForTeam.mockResolvedValue([])
        expect(await queue().drain("t1", "https://app")).toEqual({ blocked: null, started: 0 })
    })
})

describe("drainForProject", () => {
    test("resolves the owning team — a callback knows the run that finished, not "
        + "the team that paid for it", async () => {
        await queue().drainForProject("p1", "https://app")
        expect(projects.findTeamId).toHaveBeenCalledWith("p1")
        expect(dispatch.startIssue).toHaveBeenCalled()
    })

    test("an unresolvable team is reported, not guessed at", async () => {
        projects.findTeamId.mockResolvedValue(null)
        expect(await queue().drainForProject("p1", "https://app")).toEqual({ blocked: "no_team", started: 0 })
    })
})
