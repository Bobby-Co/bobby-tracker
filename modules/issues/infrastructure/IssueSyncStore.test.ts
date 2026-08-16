import { test, expect, describe, beforeEach } from "bun:test"
import { ServiceIssueSyncStore } from "./IssueSyncStore"

// Pins which plane each method writes to.
//
// Same reasoning as lib/server/http/RequestContext.test.ts: both handles are the
// same client today, so a method bound to the wrong one behaves identically and
// keeps behaving identically — right up until the planes separate, at which point
// suggestions would be written to a database the browser never subscribes to and
// the live suggestion box would simply stop updating, with no error anywhere.

/** A stand-in for the PostgREST builder: records every table touched and is
 *  awaitable at any point in the chain, which is how the real client behaves. */
function recorder() {
    const tables: string[] = []
    const result = { data: null, error: null, count: 0 }
    const chain: Record<string, unknown> = {}
    for (const m of ["select", "eq", "not", "insert", "update", "upsert", "delete", "order", "limit"]) {
        chain[m] = () => chain
    }
    chain.maybeSingle = () => Promise.resolve(result)
    chain.single = () => Promise.resolve(result)
    chain.then = (onFulfilled: (v: unknown) => unknown) => Promise.resolve(result).then(onFulfilled)
    return {
        tables,
        db: {
            from: (t: string) => {
                tables.push(t)
                return chain
            },
        },
    }
}

let data: ReturnType<typeof recorder>
let control: ReturnType<typeof recorder>
let store: ServiceIssueSyncStore

beforeEach(() => {
    data = recorder()
    control = recorder()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    store = new ServiceIssueSyncStore(data.db as any, control.db as any)
})

const suggestion = {
    issue_id: "i1",
    data: {},
    markdown: "",
    code_cites: [],
    graph_cites: [],
    confidence: null,
    cost_usd: 0,
    duration_ms: 0,
    graph_id: null,
}

// issue_suggestions is in the supabase_realtime publication, so it lives with the
// control plane alongside project_analyser and notifications.
describe("control plane — issue_suggestions", () => {
    test("insertSuggestion writes to the control handle", async () => {
        await store.insertSuggestion(suggestion)
        expect(control.tables).toEqual(["issue_suggestions"])
        expect(data.tables).toEqual([])
    })

    test("countSuggestions reads the control handle", async () => {
        await store.countSuggestions("i1")
        expect(control.tables).toEqual(["issue_suggestions"])
        expect(data.tables).toEqual([])
    })
})

describe("data plane — issues and issue_comments", () => {
    const cases: [string, () => Promise<unknown>, string][] = [
        ["findAnalysisRow", () => store.findAnalysisRow("i1"), "issues"],
        ["listLinkedGithubNumbers", () => store.listLinkedGithubNumbers("p1"), "issues"],
        ["updateSyncFields", () => store.updateSyncFields("i1", { analysis_status: "done" }), "issues"],
        [
            "insertImportedIssue",
            () =>
                store.insertImportedIssue({
                    project_id: "p1", user_id: "u1", title: "t", body: "b", status: "open",
                    github_issue_number: 1, github_node_id: null, sync_source: "github",
                    last_synced_hash: "h", github_synced_at: "2026-01-01T00:00:00Z",
                }),
            "issues",
        ],
        [
            "upsertComment",
            () => store.upsertComment("p1", { issue_number: 1, github_comment_id: 2 }),
            "issue_comments",
        ],
        ["deleteComment", () => store.deleteComment("p1", 2), "issue_comments"],
    ]

    for (const [name, run, table] of cases) {
        test(`${name} uses the data handle (${table})`, async () => {
            await run()
            expect(data.tables).toEqual([table])
            expect(control.tables).toEqual([])
        })
    }
})

// Single-argument construction must keep every method on one client, so the
// service-role call sites that have not been split yet are unaffected.
describe("single-handle construction", () => {
    test("suggestions fall back to the data handle", async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const one = new ServiceIssueSyncStore(data.db as any)
        await one.insertSuggestion(suggestion)
        await one.findAnalysisRow("i1")
        expect(data.tables).toEqual(["issue_suggestions", "issues"])
    })
})
