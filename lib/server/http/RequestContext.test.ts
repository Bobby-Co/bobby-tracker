import { test, expect, describe } from "bun:test"
import { RequestContext } from "./RequestContext"
import type { SupabaseRlsClient } from "@/lib/server/supabase"

// Pins the control-plane / data-plane classification.
//
// The split is behaviourally inert today (both handles are the same client), so
// nothing else can catch a repository bound to the wrong side — a new getter
// would simply work, and keep working, right up until the planes are actually
// separated and it starts reading from a database that doesn't have its table.
// These tests are the only thing standing between "inert seam" and "silently
// wrong seam", which is why they inspect the wiring directly rather than
// exercising behaviour.

const control = { tag: "control" } as unknown as SupabaseRlsClient
const data = { tag: "data" } as unknown as SupabaseRlsClient
const ctx = new RequestContext(control, data)

/** Repositories hold their client as `db` (see the Supabase* adapters). */
const clientOf = (repo: unknown) => (repo as { db?: unknown }).db

// Only per-issue / per-PR content is regional. The test for membership is
// whether anything ever enumerates the table across a whole team: if it does, a
// regional copy would return a silent subset, so it belongs on the control side.
describe("data plane — per-issue / per-PR content", () => {
    const cases: [string, unknown][] = [
        ["issues", ctx.issues],
        ["issueComments", ctx.issueComments],
        ["pullRequests", ctx.pullRequests],
    ]
    for (const [name, repo] of cases) {
        test(`${name} is bound to the data handle`, () => {
            expect(clientOf(repo)).toBe(data)
        })
    }
})

// Every table in the supabase_realtime publication must be control-plane: the
// browser subscribes to it directly, and it can only do that against a database
// whose JWTs it holds. Moving one of these to the data plane would silently break
// live updates the moment the planes separate.
describe("control plane — realtime tables", () => {
    const cases: [string, unknown][] = [
        ["analyser (project_analyser)", ctx.analyser],
        ["issueSuggestions", ctx.issueSuggestions],
        ["notifications", ctx.notifications],
    ]
    for (const [name, repo] of cases) {
        test(`${name} is bound to the control handle`, () => {
            expect(clientOf(repo)).toBe(control)
        })
    }
})

describe("control plane — identity, teams, billing policy", () => {
    const cases: [string, unknown][] = [
        ["projects", ctx.projects],
        ["projectDisplay", ctx.projectDisplay],
        ["publicSessions", ctx.publicSessions],
        ["sessionsAdmin", ctx.sessionsAdmin],
        ["publicIntegration", ctx.publicIntegration],
        ["mcpIntegration", ctx.mcpIntegration],
        ["collections", ctx.collections],
        ["usage", ctx.usage],
        ["teamMembership", ctx.teamMembership],
        ["teams", ctx.teams],
        ["teamInvites", ctx.teamInvites],
        ["accessGroups", ctx.accessGroups],
        ["subscriptions", ctx.subscriptions],
        ["githubTokens", ctx.githubTokens],
        ["providerTokens", ctx.providerTokens],
        ["relayWorkers", ctx.relayWorkers],
    ]
    for (const [name, repo] of cases) {
        test(`${name} is bound to the control handle`, () => {
            expect(clientOf(repo)).toBe(control)
        })
    }
})

// Authorization must never touch the data plane. If either of these regresses to
// the data handle, an access decision starts depending on a regional database
// being reachable — and under a real split it would be deciding from a database
// that does not hold the table.
describe("access — entirely control plane", () => {
    const access = ctx.access as unknown as { projects: unknown; teams: unknown }

    test("reads projects from the control handle", () => {
        expect(clientOf(access.projects)).toBe(control)
    })

    test("reads team membership from the control handle", () => {
        expect(clientOf(access.teams)).toBe(control)
    })
})

describe("escape hatch", () => {
    // CommentActions reads `projects` to gate comment authoring — control-plane.
    test("the raw client is the control handle", () => {
        expect(ctx.client).toBe(control)
    })
})

// Constructed with ONE argument, the data plane is deliberately unbound. This is
// the safety property of the regional split: a route that reaches regional data
// without first resolving which region must fail, not quietly read the central
// database and return an empty result that reads as "no issues yet".
describe("single-handle construction", () => {
    const single = { tag: "single" } as unknown as SupabaseRlsClient

    test("the control plane works immediately", () => {
        const one = new RequestContext(single)
        expect(clientOf(one.teams)).toBe(single)
        expect(one.client).toBe(single)
    })

    test("the data plane THROWS until a region is bound", () => {
        const one = new RequestContext(single)
        expect(() => one.issues).toThrow(/region was bound/)
        expect(() => one.pullRequests).toThrow(/region was bound/)
    })

    test("bindCentral binds the data plane to the control handle", () => {
        const one = new RequestContext(single)
        one.bindCentral()
        expect(clientOf(one.issues)).toBe(single)
    })

    test("an explicit second argument still pre-binds (single-database hosts)", () => {
        const two = new RequestContext(single, single)
        expect(clientOf(two.issues)).toBe(single)
    })
})
