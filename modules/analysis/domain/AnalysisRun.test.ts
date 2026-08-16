import { describe, expect, test } from "bun:test"
import { ANALYSIS_STALE_AFTER_MS, analysisIsAbandoned } from "./AnalysisRun"

const NOW = Date.parse("2026-08-17T12:00:00.000Z")
const ago = (ms: number) => new Date(NOW - ms).toISOString()

describe("analysisIsAbandoned", () => {
    test("a run that just started is live", () => {
        expect(analysisIsAbandoned(ago(30_000), NOW)).toBe(false)
    })

    test("a long but plausible run is still live — deep analysis takes minutes", () => {
        expect(analysisIsAbandoned(ago(20 * 60_000), NOW)).toBe(false)
    })

    test("past the threshold it is abandoned", () => {
        expect(analysisIsAbandoned(ago(ANALYSIS_STALE_AFTER_MS + 1), NOW)).toBe(true)
    })

    test("exactly at the threshold counts as abandoned", () => {
        expect(analysisIsAbandoned(ago(ANALYSIS_STALE_AFTER_MS), NOW)).toBe(true)
    })

    // The property that repairs existing damage: rows wedged before 0071 have no
    // start time and never will. Refusing to retry them forever is strictly worse
    // than allowing one retry.
    test("null is abandoned, so pre-0071 wedged rows self-heal", () => {
        expect(analysisIsAbandoned(null, NOW)).toBe(true)
        expect(analysisIsAbandoned(undefined, NOW)).toBe(true)
    })

    test("an unparseable timestamp is abandoned rather than trusted", () => {
        expect(analysisIsAbandoned("not a date", NOW)).toBe(true)
    })

    // Clock skew between whoever wrote the row and whoever reads it must not
    // manufacture duplicate paid runs.
    test("a start time in the future is treated as live, not abandoned", () => {
        expect(analysisIsAbandoned(new Date(NOW + 60_000).toISOString(), NOW)).toBe(false)
    })

    test("the threshold is overridable for callers with different tolerances", () => {
        expect(analysisIsAbandoned(ago(5_000), NOW, 1_000)).toBe(true)
        expect(analysisIsAbandoned(ago(5_000), NOW, 60_000)).toBe(false)
    })
})
