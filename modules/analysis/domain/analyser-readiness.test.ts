import { test, expect } from "bun:test"
import { isAnalyserReady } from "./analyser-readiness"

const ready = { enabled: true, status: "ready", graph_id: "g1" }

test("isAnalyserReady — true only when enabled AND status 'ready' AND has graph_id", () => {
    expect(isAnalyserReady(ready)).toBe(true)
})

test("isAnalyserReady — false for null/undefined and every missing precondition", () => {
    expect(isAnalyserReady(null)).toBe(false)
    expect(isAnalyserReady(undefined)).toBe(false)
    expect(isAnalyserReady({ ...ready, enabled: false })).toBe(false)
    expect(isAnalyserReady({ ...ready, enabled: null })).toBe(false)
    expect(isAnalyserReady({ ...ready, status: "indexing" })).toBe(false)
    expect(isAnalyserReady({ ...ready, graph_id: null })).toBe(false)
})
