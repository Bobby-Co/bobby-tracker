import { test, expect, describe } from "bun:test"
import { ProjectInsight } from "./ProjectInsight"
import type { ProjectInsightState } from "./ProjectInsight"

const NOW = Date.parse("2026-07-20T12:00:00.000Z")
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString()

const base: ProjectInsightState = {
    open_total: 0,
    done_total: 0,
    urgent_open: 0,
    last_urgent_at: null,
    last_issue_created_at: null,
    recent_pr_opens: [],
}

const status = (state: ProjectInsightState | null) => ProjectInsight.of(state).status(NOW)

describe("ProjectInsight.status — strict priority, first match wins", () => {
    test("no insight → clear", () => {
        expect(status(null)).toEqual({ kind: "clear", at: null })
    })

    test("urgent within 24h outranks everything → critical", () => {
        const at = hoursAgo(1)
        expect(status({ ...base, urgent_open: 3, last_urgent_at: at, open_total: 5 })).toEqual({
            kind: "critical",
            count: 3,
            at,
        })
    })

    test("urgent older than 24h no longer critical → falls through", () => {
        expect(status({ ...base, urgent_open: 3, last_urgent_at: hoursAgo(25), open_total: 5 }).kind).not.toBe("critical")
    })

    test("a PR opened within 6h → pr, counting only recent ones, at the latest", () => {
        const recent = [hoursAgo(1), hoursAgo(3)]
        const s = status({ ...base, recent_pr_opens: [...recent, hoursAgo(48)], open_total: 2 })
        expect(s.kind).toBe("pr")
        if (s.kind === "pr") {
            expect(s.count).toBe(2) // the 48h-old one is excluded
            expect(s.at).toBe(hoursAgo(1))
        }
    })

    test("no signals, no issues → clear at last_issue_created_at", () => {
        expect(status({ ...base, last_issue_created_at: hoursAgo(100) })).toEqual({ kind: "clear", at: hoursAgo(100) })
    })

    test("no signals but issues exist → progress with done/total", () => {
        const at = hoursAgo(2)
        expect(status({ ...base, open_total: 4, done_total: 3, last_issue_created_at: at })).toEqual({
            kind: "progress",
            done: 3,
            total: 7,
            at,
        })
    })
})
