import { test, expect, describe } from "bun:test"
import { Project } from "./Project"
import type { ProjectSyncState } from "./Project"

const wired: ProjectSyncState = {
    github_sync_enabled: true,
    github_installation_id: 123,
    github_repo_id: 456,
    github_sync_direction: "both",
    github_sync_deletes: false,
}

describe("Project.isSyncReady — the push/pull precondition", () => {
    test("true only when enabled AND installation AND repo are all present", () => {
        expect(Project.of(wired).isSyncReady()).toBe(true)
    })
    test("false if any of the three is missing", () => {
        expect(Project.of({ ...wired, github_sync_enabled: false }).isSyncReady()).toBe(false)
        expect(Project.of({ ...wired, github_installation_id: null }).isSyncReady()).toBe(false)
        expect(Project.of({ ...wired, github_repo_id: null }).isSyncReady()).toBe(false)
    })
})

describe("Project sync direction", () => {
    test("both allows inbound and outbound", () => {
        const p = Project.of({ ...wired, github_sync_direction: "both" })
        expect(p.allowsInbound()).toBe(true)
        expect(p.allowsOutbound()).toBe(true)
    })
    test("inbound allows only inbound; outbound only outbound", () => {
        expect(Project.of({ ...wired, github_sync_direction: "inbound" }).allowsInbound()).toBe(true)
        expect(Project.of({ ...wired, github_sync_direction: "inbound" }).allowsOutbound()).toBe(false)
        expect(Project.of({ ...wired, github_sync_direction: "outbound" }).allowsOutbound()).toBe(true)
        expect(Project.of({ ...wired, github_sync_direction: "outbound" }).allowsInbound()).toBe(false)
    })
    test("absent direction (lighter projections) allows neither", () => {
        const p = Project.of({ github_sync_enabled: true, github_installation_id: 1, github_repo_id: 2 })
        expect(p.allowsInbound()).toBe(false)
        expect(p.allowsOutbound()).toBe(false)
    })
})

describe("Project.propagatesDeletes", () => {
    test("true only when explicitly enabled; default/absent is false", () => {
        expect(Project.of({ ...wired, github_sync_deletes: true }).propagatesDeletes()).toBe(true)
        expect(Project.of({ ...wired, github_sync_deletes: false }).propagatesDeletes()).toBe(false)
        expect(Project.of({ github_sync_enabled: true, github_installation_id: 1, github_repo_id: 2 }).propagatesDeletes()).toBe(false)
    })
})
