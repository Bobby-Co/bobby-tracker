import { test, expect, describe } from "bun:test"
import { ProjectAnalyser } from "./project-analyser"

const ready = { enabled: true, status: "ready", graph_id: "g1" }

describe("ProjectAnalyser.isReady", () => {
    test("true only when enabled AND status ready AND a graph id", () => {
        expect(ProjectAnalyser.of(ready).isReady()).toBe(true)
    })
    test("false for each missing precondition + null/empty graph", () => {
        expect(ProjectAnalyser.of({ ...ready, enabled: false }).isReady()).toBe(false)
        expect(ProjectAnalyser.of({ ...ready, enabled: null }).isReady()).toBe(false)
        expect(ProjectAnalyser.of({ ...ready, status: "indexing" }).isReady()).toBe(false)
        expect(ProjectAnalyser.of({ ...ready, graph_id: null }).isReady()).toBe(false)
        expect(ProjectAnalyser.of({ ...ready, graph_id: "" }).isReady()).toBe(false)
    })
    test("from() is null-safe — absent analyser is not ready", () => {
        expect(ProjectAnalyser.from(null).isReady()).toBe(false)
        expect(ProjectAnalyser.from(undefined).isReady()).toBe(false)
    })
})

describe("ProjectAnalyser status helpers", () => {
    test("isIndexing / hasFailed / isEnabled", () => {
        expect(ProjectAnalyser.of({ enabled: true, status: "indexing", graph_id: null }).isIndexing()).toBe(true)
        expect(ProjectAnalyser.of({ enabled: true, status: "failed", graph_id: null }).hasFailed()).toBe(true)
        expect(ProjectAnalyser.of({ enabled: false, status: "ready", graph_id: "g" }).isEnabled()).toBe(false)
    })
    test("hasStarted is true for indexing/ready/failed, false for disabled/pending", () => {
        for (const s of ["indexing", "ready", "failed"]) {
            expect(ProjectAnalyser.of({ enabled: true, status: s, graph_id: "g" }).hasStarted()).toBe(true)
        }
        for (const s of ["disabled", "pending", null]) {
            expect(ProjectAnalyser.of({ enabled: true, status: s, graph_id: "g" }).hasStarted()).toBe(false)
        }
    })
})
