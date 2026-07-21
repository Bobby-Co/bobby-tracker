import { test, expect, describe } from "bun:test"
import { Issue } from "./issue"

describe("Issue.isClosed — the app's closed set", () => {
    test("done / archived / duplicated are closed", () => {
        for (const s of ["done", "archived", "duplicated"] as const) {
            expect(Issue.of({ status: s }).isClosed()).toBe(true)
            expect(Issue.of({ status: s }).isOpen()).toBe(false)
        }
    })
    test("open / in_progress / blocked are open", () => {
        for (const s of ["open", "in_progress", "blocked"] as const) {
            expect(Issue.of({ status: s }).isClosed()).toBe(false)
            expect(Issue.of({ status: s }).isOpen()).toBe(true)
        }
    })
})

describe("Issue.githubState — differs from isClosed on 'duplicated'", () => {
    test("done + archived close the GitHub issue", () => {
        expect(Issue.of({ status: "done" }).githubState()).toBe("closed")
        expect(Issue.of({ status: "archived" }).githubState()).toBe("closed")
    })
    test("duplicated stays OPEN on GitHub even though it's 'closed' in-app", () => {
        expect(Issue.of({ status: "duplicated" }).isClosed()).toBe(true)
        expect(Issue.of({ status: "duplicated" }).githubState()).toBe("open")
    })
    test("open / in_progress / blocked stay open", () => {
        for (const s of ["open", "in_progress", "blocked"] as const) {
            expect(Issue.of({ status: s }).githubState()).toBe("open")
        }
    })
})

describe("Issue GitHub link + inbound mapping", () => {
    test("isLinkedToGithub reflects a mirrored number", () => {
        expect(Issue.of({ status: "open", github_issue_number: 12 }).isLinkedToGithub()).toBe(true)
        expect(Issue.of({ status: "open", github_issue_number: null }).isLinkedToGithub()).toBe(false)
        expect(Issue.of({ status: "open" }).isLinkedToGithub()).toBe(false)
    })
    test("statusFromGithubState maps closed→done, open→open", () => {
        expect(Issue.statusFromGithubState("closed")).toBe("done")
        expect(Issue.statusFromGithubState("open")).toBe("open")
    })
})

// Invariants a refactor must preserve — if you add a status or move these rules
// onto transition methods, these stay the fixed contract.
describe("Issue — refactor-guard invariants", () => {
    const ALL: import("./issue").IssueStatusValue[] =
        ["open", "in_progress", "blocked", "done", "archived", "duplicated"]

    test("every status is classified open XOR closed (no unclassified status)", () => {
        for (const s of ALL) {
            const i = Issue.of({ status: s })
            expect(i.isOpen()).toBe(!i.isClosed())
        }
    })
    test("githubState only ever returns open or closed for every status", () => {
        for (const s of ALL) {
            expect(["open", "closed"]).toContain(Issue.of({ status: s }).githubState())
        }
    })
    test("inbound state → status → githubState round-trips (open/closed stable)", () => {
        for (const state of ["open", "closed"] as const) {
            const status = Issue.statusFromGithubState(state)
            expect(Issue.of({ status }).githubState()).toBe(state)
        }
    })
})
