import { describe, expect, test } from "bun:test"
import { VcsAppService } from "./VcsAppService"
import type { VcsAppInstance } from "../ports/VcsAppInstance"
import type { VcsBranch, VcsCompare, VcsCompareStatus, VcsPullRequestFile } from "../ports/VcsTypes"
import type { IssueSyncStore } from "@/modules/issues"

// What "diverged" decides: whether indexing a branch COPIES the default
// branch's analysis (free) or re-runs it from scratch (a real bill). Getting it
// wrong in the permissive direction leaves stale summaries; getting it wrong in
// the strict direction charges for a full analysis on every ordinary branch.

function files(n: number): VcsPullRequestFile[] {
    return Array.from({ length: n }, (_, i) => ({
        path: `src/file-${i}.ts`,
        status: "modified",
        additions: 1,
        deletions: 1,
    })) as VcsPullRequestFile[]
}

function service(opts: {
    branches?: VcsBranch[]
    status?: VcsCompareStatus
    fileCount?: number
    truncated?: boolean
    throws?: boolean
}) {
    const vcs = {
        async listBranches(): Promise<VcsBranch[]> {
            if (opts.throws) throw new Error("provider unreachable")
            return (
                opts.branches ?? [
                    { name: "main", sha: "a", isDefault: true, isProtected: true },
                    { name: "feat/x", sha: "b", isDefault: false, isProtected: false },
                ]
            )
        },
        async compareCommits(): Promise<VcsCompare> {
            return {
                status: opts.status ?? "diverged",
                aheadBy: 3,
                behindBy: 40,
                files: files(opts.fileCount ?? 4),
                commits: [],
                truncated: opts.truncated ?? false,
            }
        },
    } as unknown as VcsAppInstance
    return new VcsAppService(vcs, {} as IssueSyncStore)
}

describe("branchDivergence", () => {
    // The bug this exists to stop coming back.
    //
    // compareCommits reports "diverged" whenever BOTH refs hold commits the
    // other does not — true of essentially every feature branch that has not
    // just been rebased. Make a branch, let main move on, and you are
    // "diverged". Reading that as "too far apart to inherit" sent the ordinary
    // case down the full-analysis path: the exact branches the copy design
    // exists to make free.
    test("an ordinary branch is not diverged just because histories forked", async () => {
        const svc = service({ status: "diverged", fileCount: 4 })
        const out = await svc.branchDivergence("feat/x")
        expect(out.diverged).toBe(false)
        expect(out.baseRef).toBe("main")
    })

    test("a branch that rewrites most of the repository is", async () => {
        const svc = service({ status: "diverged", fileCount: 400 })
        expect((await svc.branchDivergence("feat/x")).diverged).toBe(true)
    })

    // A truncated compare is not a small change — it is an undescribed one.
    // GitHub caps at 300 files / 250 commits, and the incremental PR review
    // refuses to carry findings across a truncated range for the same reason.
    test("a truncated comparison counts as diverged whatever it managed to list", async () => {
        const svc = service({ status: "ahead", fileCount: 2, truncated: true })
        expect((await svc.branchDivergence("feat/x")).diverged).toBe(true)
    })

    // Failure must take the CHEAP path. Guessing "diverged" on a flaky API call
    // would spend a full analysis every time the provider hiccuped.
    test("an unreachable provider is not diverged", async () => {
        const svc = service({ throws: true })
        expect((await svc.branchDivergence("feat/x")).diverged).toBe(false)
    })

    // The default branch is the thing being copied FROM; it has no divergence
    // from itself and must never be sent down either branch path.
    test("the default branch compares to nothing", async () => {
        const svc = service({ status: "diverged", fileCount: 999 })
        const out = await svc.branchDivergence("main")
        expect(out.diverged).toBe(false)
        expect(out.baseRef).toBeUndefined()
    })
})
