import { test, expect, describe, mock } from "bun:test"
import { selectIssueBranch } from "./BranchSelection"

function repo(row: { branch: string; status: string } | null) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { find: mock(async () => row) } as any
}

describe("selectIssueBranch", () => {
    // The default tree is the norm, not a failure: most projects track no
    // branches at all, and every GitHub-imported issue arrives without one.
    test("no branch is the default tree, not an error", async () => {
        for (const input of [undefined, null, "", "   ", 7]) {
            expect(await selectIssueBranch(repo(null), "p1", input)).toEqual({ ok: true, branch: null })
        }
    })

    test("a tracked, ready branch is accepted", async () => {
        const r = await selectIssueBranch(repo({ branch: "feat/x", status: "ready" }), "p1", "feat/x")
        expect(r).toEqual({ ok: true, branch: "feat/x" })
    })

    // Storing it would file the issue against a tree that cannot answer, and the
    // user would only find out later, as an analysis that quietly read trunk.
    test("a branch the project doesn't track is refused", async () => {
        const r = await selectIssueBranch(repo(null), "p1", "feat/nope")
        expect(r.ok).toBe(false)
        if (!r.ok) {
            expect(r.code).toBe("branch_not_indexed")
            expect(r.message).toContain("doesn't index")
        }
    })

    // Different message from "not tracked": the action is to wait, not to track.
    test("a tracked branch that hasn't finished indexing is refused, and says so", async () => {
        for (const status of ["pending", "indexing", "failed"]) {
            const r = await selectIssueBranch(repo({ branch: "feat/x", status }), "p1", "feat/x")
            expect(r.ok).toBe(false)
            if (!r.ok) expect(r.message).toContain(status)
        }
    })

    // Trimming happens before the lookup, so " feat/x " finds the tracked row.
    test("the name is normalised before it is looked up", async () => {
        const branches = repo({ branch: "feat/x", status: "ready" })
        await selectIssueBranch(branches, "p1", "  feat/x  ")
        expect(branches.find).toHaveBeenCalledWith("p1", "feat/x")
    })
})
