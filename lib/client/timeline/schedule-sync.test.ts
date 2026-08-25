import { describe, expect, test } from "bun:test"
import { ScheduleOutbox } from "./outbox"
import { patchApplied } from "./use-schedule-sync"
import { ABS_LANES, laneToRowAbs, rowToLaneAbs } from "./grid"
import type { Issue } from "@/lib/shared/types"

// The board is optimistic: a gesture updates local state and the write
// happens later, in the background. These are the rules that keep the two
// from drifting apart — every one of them is a tile visibly jumping back
// to an old cell when it's wrong.

function issue(over: Partial<Issue> = {}): Issue {
    return {
        id: "i1",
        starts_at: "2026-08-18T00:00:00.000Z",
        ends_at: "2026-08-19T00:00:00.000Z",
        lane_y: 0.5,
        color: null,
        ...over,
    } as Issue
}

describe("ScheduleOutbox", () => {
    test("merges repeated edits of one issue into a single patch", () => {
        const box = new ScheduleOutbox("p1")
        box.enqueue("i1", { lane_y: 0.1 })
        box.enqueue("i1", { starts_at: "2026-08-18T00:00:00.000Z" })
        expect(box.size()).toBe(1)
        expect(box.peek("i1")!.patch).toEqual({
            lane_y: 0.1,
            starts_at: "2026-08-18T00:00:00.000Z",
        })
    })

    test("a flush cannot clear an edit made while it was in flight", () => {
        const box = new ScheduleOutbox("p2")
        box.enqueue("i1", { lane_y: 0.1 })
        const sent = box.peek("i1")!          // what the PATCH carries

        box.enqueue("i1", { lane_y: 0.9 })    // user drags again mid-flight

        expect(box.remove("i1", sent.seq)).toBe(false)
        expect(box.peek("i1")!.patch.lane_y).toBe(0.9)
    })

    test("a flush clears the entry it actually sent", () => {
        const box = new ScheduleOutbox("p3")
        box.enqueue("i1", { lane_y: 0.1 })
        const sent = box.peek("i1")!
        expect(box.remove("i1", sent.seq)).toBe(true)
        expect(box.size()).toBe(0)
    })
})

describe("patchApplied", () => {
    test("sees through the DB's timestamp formatting", () => {
        expect(
            patchApplied(issue({ starts_at: "2026-08-18T00:00:00+00:00" }), {
                starts_at: "2026-08-18T00:00:00.000Z",
            }),
        ).toBe(true)
    })

    test("tolerates lane_y coming back at float4 precision", () => {
        const sent = rowToLaneAbs(19)
        expect(patchApplied(issue({ lane_y: Math.fround(sent) }), { lane_y: sent })).toBe(true)
    })

    test("a row the server hasn't caught up on is not applied", () => {
        expect(patchApplied(issue({ lane_y: 0.5 }), { lane_y: 0.9 })).toBe(false)
        expect(
            patchApplied(issue(), { starts_at: "2026-09-01T00:00:00.000Z" }),
        ).toBe(false)
    })

    test("unscheduling round-trips as nulls", () => {
        const cleared = issue({ starts_at: null, ends_at: null, lane_y: null })
        expect(patchApplied(cleared, { starts_at: null, ends_at: null, lane_y: null })).toBe(true)
        expect(patchApplied(issue(), { starts_at: null })).toBe(false)
    })
})

describe("absolute lane rows", () => {
    test("every row on the board round-trips through float4 storage", () => {
        for (let row = 0; row < ABS_LANES; row++) {
            const laneY = rowToLaneAbs(row)
            expect(laneY).toBeGreaterThanOrEqual(0)
            expect(laneY).toBeLessThanOrEqual(1)
            expect(laneToRowAbs(Math.fround(laneY))).toBe(row)
        }
    })

    test("rows off the board clamp into what lane_y can store", () => {
        for (const row of [-99, -1, ABS_LANES, 1000]) {
            const laneY = rowToLaneAbs(row)
            expect(laneY).toBeGreaterThanOrEqual(0)
            expect(laneY).toBeLessThanOrEqual(1)
        }
    })

    test("legacy fractions from the old lane model decode in order", () => {
        expect(laneToRowAbs(0)).toBe(0)
        expect(laneToRowAbs(0.5)).toBe(32)
        expect(laneToRowAbs(1)).toBe(ABS_LANES - 1)
    })
})
