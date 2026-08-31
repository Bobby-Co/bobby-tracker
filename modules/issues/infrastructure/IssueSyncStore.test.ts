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
    // `data` defaults to one row: updateSyncFields now treats a zero-row match as
    // a failure (it is the signature of a write aimed at the wrong region), so a
    // fake that answers "nothing matched" means "this write did not land".
    const result: { data: unknown; error: unknown; count: number } = { data: [{ id: "i1" }], error: null, count: 0 }
    const chain: Record<string, unknown> = {}
    // Filters are recorded as well as swallowed: which COLUMN a read filters on,
    // and with which operator, is load-bearing for the branch-keyed cache.
    const filters: [string, unknown, unknown][] = []
    for (const m of ["select", "not", "insert", "update", "upsert", "delete", "order", "limit"]) {
        chain[m] = () => chain
    }
    for (const m of ["eq", "is"]) {
        chain[m] = (col: unknown, val: unknown) => {
            filters.push([m, col, val])
            return chain
        }
    }
    chain.maybeSingle = () => Promise.resolve(result)
    chain.single = () => Promise.resolve(result)
    chain.then = (onFulfilled: (v: unknown) => unknown) => Promise.resolve(result).then(onFulfilled)
    return {
        tables,
        filters,
        /** Make the next statement match nothing, as a wrong-region write does. */
        matchNothing() {
            result.data = []
        },
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
    branch: null,
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

    // The cache is keyed by TREE, and the default tree is stored as null. A
    // `.eq("branch", null)` renders as `= NULL`, matches nothing, and would make
    // every untagged issue look uncached — re-running (and re-billing) a paid
    // analysis on every ask. `.is` is the only spelling that matches.
    test("countSuggestions matches the default tree with IS NULL, not = NULL", async () => {
        await store.countSuggestions("i1")
        expect(control.filters).toContainEqual(["is", "branch", null])

        control.filters.length = 0
        await store.countSuggestions("i1", "feat/x")
        expect(control.filters).toContainEqual(["eq", "branch", "feat/x"])
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

    // The whole point of the row-count check. Before it, an update aimed at the
    // wrong region matched nothing, returned no error, and read as success — so
    // analysis_status never persisted and the page re-dispatched a paid analysis
    // on every refresh, each one "succeeding".
    test("updateSyncFields THROWS when the update matches no rows", async () => {
        data.matchNothing()
        await expect(store.updateSyncFields("i1", { analysis_status: "analysing" })).rejects.toThrow(
            /matched no rows/,
        )
    })
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
