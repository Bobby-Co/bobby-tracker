// Characterization tests for the PR-review kickoff — the branching that decides
// whether a `pull_request` event actually costs an analyser run. Collaborators
// arrive by CONSTRUCTOR (DI), so plain mocks stand in for the leaf boundaries
// while the PURE entities (Project, ProjectAnalyser) stay real so the genuine
// readiness gates run.

import { test, expect, describe, mock, beforeAll, beforeEach } from "bun:test"
import { Project as RealProject } from "@/modules/projects/domain/Project"
import { PullRequestAnalysisComment } from "./PullRequestAnalysisComment"

const store = {
    findTracking: mock(), upsertTracking: mock(), findResultRow: mock(), saveResult: mock(),
    appendRound: mock(), listRounds: mock(), setPendingHead: mock(), clearPendingHead: mock(),
    enqueueTracking: mock(),
}
const pulls = { findByNumber: mock() }
const projectsRepo = { findCell: mock(), findGithubSyncContext: mock(), findTeamId: mock(async () => "team-1") }
const analyserRepo = { findReadiness: mock() }
const analyser = { startPRAnalysis: mock(), cancelPRAnalysis: mock() }
const analyserFor = mock(() => analyser)
const vcsSvc = { listPullRequestFiles: mock(), compareCommits: mock(), postPrComment: mock(), updatePrComment: mock() }
const vcsFor = () => vcsSvc

mock.module("@/modules/projects", () => ({
    Project: RealProject,
    createSupabaseProjectsRepository: () => projectsRepo,
}))

let PullRequestAnalysisService: typeof import("./PullRequestAnalysisService").PullRequestAnalysisService
beforeAll(async () => {
    ;({ PullRequestAnalysisService } = await import("./PullRequestAnalysisService"))
})

// The billing hard gate (0076): null means the team may spend.
const spend = { check: mock(async () => null as null | { reason: string; message: string }) }
// Admission (the per-team concurrency bound) defaults to PERMISSIVE here: these
// tests are about the review lifecycle, and a cap that refused by default would
// make every one of them pass for the wrong reason. The bound's own behaviour is
// pinned in modules/analysis/application/RunAdmission.test.ts.
const admission = { check: mock(async () => null) }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const svc = () => new PullRequestAnalysisService(analyserFor as any, projectsRepo as any, analyserRepo as any, store as any, vcsFor as any, new PullRequestAnalysisComment(), spend as any, admission as any)

beforeEach(() => {
    store.findTracking.mockReset().mockResolvedValue(null)
    store.appendRound.mockReset().mockResolvedValue(undefined)
    store.listRounds.mockReset().mockResolvedValue([])
    store.setPendingHead.mockReset().mockResolvedValue(undefined)
    store.clearPendingHead.mockReset().mockResolvedValue(undefined)
    store.enqueueTracking.mockReset().mockResolvedValue(undefined)
    // Both gates default to PERMISSIVE, and both are RESET here: before the
    // queue existed no test changed them, so nothing in this file reset them
    // and a test that did would have leaked into every test after it.
    spend.check.mockReset().mockResolvedValue(null)
    admission.check.mockReset().mockResolvedValue(null)
    pulls.findByNumber.mockReset().mockResolvedValue(null)
    projectsRepo.findGithubSyncContext.mockReset()
    store.upsertTracking.mockReset().mockResolvedValue({ id: "task-1" })
    projectsRepo.findCell.mockReset().mockResolvedValue("ashburn-0")
    analyserRepo.findReadiness.mockReset().mockResolvedValue({ enabled: true, status: "ready", graph_id: "G1" })
    analyser.startPRAnalysis.mockReset().mockResolvedValue(undefined)
    analyserFor.mockClear()
    vcsSvc.listPullRequestFiles.mockReset().mockResolvedValue([{ filename: "a.ts", status: "modified", patch: "@@", additions: 1, deletions: 0 }])
    // No compare by default: the provider cannot place the heads, which leaves
    // every round FULL — the behaviour before incremental review existed.
    vcsSvc.compareCommits.mockReset().mockRejectedValue(new Error("no compare"))
    vcsSvc.postPrComment.mockReset().mockResolvedValue({ id: 9001 })
    vcsSvc.updatePrComment.mockReset().mockResolvedValue(undefined)
})

const project = {
    id: "proj-1",
    repo_url: null,
    repo_full_name: "acme/widgets",
    github_installation_id: 77,
    github_repo_id: 88,
    github_sync_enabled: true,
}
const pr = { number: 7, title: "T", body: "B", baseSha: "base1", headSha: "head1" }

describe("start — run-once-per-head idempotency", () => {
    test("no prior row → runs", async () => {
        await svc().start(project, pr, "https://app")
        expect(analyser.startPRAnalysis).toHaveBeenCalledTimes(1)
    })

    test("a run in flight → left alone", async () => {
        store.findTracking.mockResolvedValue({ id: "t", status: "analysing", githubCommentId: 1, headSha: "head1" })
        await svc().start(project, pr, "https://app")
        expect(analyser.startPRAnalysis).not.toHaveBeenCalled()
    })

    // The wedge this exists to break: `reopened` / `edited` / `labeled` all carry
    // the same head, so revisiting a PR days later used to re-run a finished review.
    test("a FINISHED run on the same head → no re-run, no comment touched", async () => {
        store.findTracking.mockResolvedValue({ id: "t", status: "done", githubCommentId: 1, headSha: "head1" })
        await svc().start(project, pr, "https://app")
        expect(analyser.startPRAnalysis).not.toHaveBeenCalled()
        expect(vcsSvc.listPullRequestFiles).not.toHaveBeenCalled()
        expect(vcsSvc.updatePrComment).not.toHaveBeenCalled()
    })

    test("a FINISHED run on an OLDER head (synchronize) → re-runs", async () => {
        store.findTracking.mockResolvedValue({ id: "t", status: "done", githubCommentId: 1, headSha: "head0" })
        await svc().start(project, pr, "https://app")
        expect(analyser.startPRAnalysis).toHaveBeenCalledTimes(1)
    })

    test("force (the manual button) re-runs a finished review on the same head", async () => {
        store.findTracking.mockResolvedValue({ id: "t", status: "done", githubCommentId: 1, headSha: "head1" })
        await svc().start(project, pr, "https://app", { force: true })
        expect(analyser.startPRAnalysis).toHaveBeenCalledTimes(1)
    })

    test("failed/cancelled runs still retry — the head gate is for FINISHED runs only", async () => {
        for (const status of ["failed", "cancelled"]) {
            analyser.startPRAnalysis.mockClear()
            store.findTracking.mockResolvedValue({ id: "t", status, githubCommentId: 1, headSha: "head1" })
            await svc().start(project, pr, "https://app")
            expect(analyser.startPRAnalysis).toHaveBeenCalledTimes(1)
        }
    })

    test("an unknown head can't match — a null-head row still runs", async () => {
        store.findTracking.mockResolvedValue({ id: "t", status: "done", githubCommentId: 1, headSha: null })
        await svc().start(project, { ...pr, headSha: null }, "https://app")
        expect(analyser.startPRAnalysis).toHaveBeenCalledTimes(1)
    })
})

// ─── an unreadable profile is loud (not just survivable) ────────────────────
//
// Falling back to the default reviewer is the RIGHT behaviour — a settings read
// that fails must not cost somebody their review. What was wrong was doing it in
// total silence: the resulting review is byte-identical to one where no profile
// was ever assigned, so a broken profile and a working one that found nothing
// look the same on the page AND in the logs. These pin the warning.
describe("start — the concurrency cap queues instead of dropping", () => {
    test("at the cap the review is QUEUED, and no placeholder comment is posted — "
        + "a waiting review must not leave a comment on the branch claiming work "
        + "is under way", async () => {
        admission.check.mockResolvedValue({ reason: "too_many_runs", message: "full" })
        await svc().start(project, pr, "https://app")
        expect(analyser.startPRAnalysis).not.toHaveBeenCalled()
        expect(vcsSvc.postPrComment).not.toHaveBeenCalled()
        expect(store.enqueueTracking).toHaveBeenCalledWith({
            projectId: "proj-1",
            prNumber: 7,
            headSha: "head1",
            githubCommentId: null,
        })
    })

    test("the queued row remembers the head, so the drain reviews what is current "
        + "when a slot frees rather than the push that happened to arrive first", async () => {
        store.findTracking.mockResolvedValue({ id: "t", status: "queued", githubCommentId: 5, headSha: "head0" })
        await svc().start(project, pr, "https://app")
        expect(store.enqueueTracking).toHaveBeenCalledWith({
            projectId: "proj-1",
            prNumber: 7,
            headSha: "head1",
            githubCommentId: 5,
        })
        expect(analyser.startPRAnalysis).not.toHaveBeenCalled()
    })

    test("a push at the SAME head as the queued row changes nothing", async () => {
        store.findTracking.mockResolvedValue({ id: "t", status: "queued", githubCommentId: 5, headSha: "head1" })
        await svc().start(project, pr, "https://app")
        expect(store.enqueueTracking).not.toHaveBeenCalled()
        expect(analyser.startPRAnalysis).not.toHaveBeenCalled()
    })

    test("a head already reviewed is NOT queued — the cap is checked after the "
        + "head gate, so a push needing no review never takes a queue slot", async () => {
        store.findTracking.mockResolvedValue({ id: "t", status: "done", githubCommentId: 1, headSha: "head1" })
        admission.check.mockResolvedValue({ reason: "too_many_runs", message: "full" })
        await svc().start(project, pr, "https://app")
        expect(store.enqueueTracking).not.toHaveBeenCalled()
    })

    test("an exhausted balance still drops the review rather than queueing it", async () => {
        spend.check.mockResolvedValue({ reason: "exhausted", message: "out" })
        admission.check.mockResolvedValue(null)
        await svc().start(project, pr, "https://app")
        expect(store.enqueueTracking).not.toHaveBeenCalled()
        expect(analyser.startPRAnalysis).not.toHaveBeenCalled()
    })
})

describe("start — an unreadable review profile", () => {
    const boom = () => {
        const e = new Error("column projects.review_profile_id does not exist")
        e.name = "RepositoryError"
        return e
    }
    // The real class, so `instanceof` matches the branch under test.
    let RepositoryError: typeof import("@/lib/shared/kernel").RepositoryError
    beforeAll(async () => {
        ;({ RepositoryError } = await import("@/lib/shared/kernel"))
    })

    const withProfiles = (profiles: unknown) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        new PullRequestAnalysisService(analyserFor as any, projectsRepo as any, analyserRepo as any, store as any, vcsFor as any, new PullRequestAnalysisComment(), spend as any, admission as any, profiles as any)

    test("the review still runs, as the default reviewer", async () => {
        const profiles = { findForProject: mock(async () => { throw new RepositoryError(boom().message) }) }
        const warn = mock(() => {})
        const original = console.warn
        console.warn = warn
        try {
            await withProfiles(profiles).start(project, pr, "https://app")
        } finally {
            console.warn = original
        }
        expect(analyser.startPRAnalysis).toHaveBeenCalledTimes(1)
        // No policy on the wire, and the row records the DEFAULT explicitly —
        // never "a profile ran", which would be a lie about what reviewed this.
        expect(analyser.startPRAnalysis.mock.calls[0][0].policy).toBeUndefined()
        expect(store.upsertTracking.mock.calls[0][0].reviewProfile).toEqual({ kind: "default" })
    })

    test("and it says so, naming the project and the cause", async () => {
        const profiles = { findForProject: mock(async () => { throw new RepositoryError("column projects.review_profile_id does not exist") }) }
        const warn = mock(() => {})
        const original = console.warn
        console.warn = warn
        try {
            await withProfiles(profiles).start(project, pr, "https://app")
        } finally {
            console.warn = original
        }
        // Matched by content rather than by call COUNT: start() legitimately
        // warns about other degradations on the same run (a compare it could not
        // make, for one), and a test that counts them turns every new diagnostic
        // into a failure here — which is how diagnostics stop getting added.
        const line = warn.mock.calls.map((c) => String(c[0])).find((l) => l.includes("review profile"))
        expect(line).toBeDefined()
        expect(line).toContain("proj-1")
        expect(line).toContain("review_profile_id")
        expect(line).toContain("DEFAULT")
    })

    // A bug in our own code must not be laundered into "no profile today".
    test("a non-repository error still propagates", async () => {
        const profiles = { findForProject: mock(async () => { throw new TypeError("undefined is not a function") }) }
        await expect(withProfiles(profiles).start(project, pr, "https://app")).rejects.toThrow(TypeError)
    })
})

// ─── pushes that land while a review is running (0080) ──────────────────────
//
// This used to `return` outright, keeping no record at all. A developer pushing
// split work — three pushes a minute apart — had pushes two and three vanish:
// the review finished describing head one, the comment described code no longer
// in the pull request, the merge gate judged that stale review, and nothing was
// left to trigger a re-run. Recording the head makes the running review its own
// debounce window.
describe("start — a push during an in-flight review", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svcWithPulls = () => new PullRequestAnalysisService(analyserFor as any, projectsRepo as any, analyserRepo as any, store as any, vcsFor as any, new PullRequestAnalysisComment(), spend as any, admission as any, undefined, undefined, pulls as any)

    test("records the new head instead of dropping it", async () => {
        store.findTracking.mockResolvedValue({ id: "t", status: "analysing", githubCommentId: 1, headSha: "head0", pendingHeadSha: null })
        await svcWithPulls().start(project, { ...pr, headSha: "head1" }, "https://app")

        expect(analyser.startPRAnalysis).not.toHaveBeenCalled()
        expect(store.setPendingHead).toHaveBeenCalledTimes(1)
        expect(store.setPendingHead.mock.calls[0].slice(0, 3)).toEqual(["proj-1", 7, "head1"])
    })

    // The same head arriving again (reopened, labeled, edited) is not a move.
    test("the same head is not recorded as pending", async () => {
        store.findTracking.mockResolvedValue({ id: "t", status: "analysing", githubCommentId: 1, headSha: "head1", pendingHeadSha: null })
        await svcWithPulls().start(project, { ...pr, headSha: "head1" }, "https://app")
        expect(store.setPendingHead).not.toHaveBeenCalled()
    })

    // Ten pushes during one review must not become ten reviews: last write wins,
    // and only the final head is ever reviewed.
    test("several pushes coalesce to the latest head", async () => {
        store.findTracking.mockResolvedValue({ id: "t", status: "analysing", githubCommentId: 1, headSha: "head0", pendingHeadSha: null })
        const svc2 = svcWithPulls()
        for (const sha of ["head1", "head2", "head3"]) {
            await svc2.start(project, { ...pr, headSha: sha }, "https://app")
        }
        expect(analyser.startPRAnalysis).not.toHaveBeenCalled()
        expect(store.setPendingHead).toHaveBeenCalledTimes(3)
        expect(store.setPendingHead.mock.calls[2][2]).toBe("head3")
    })
})

describe("applyResult — rounds and the continuation", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svcWithPulls = () => new PullRequestAnalysisService(analyserFor as any, projectsRepo as any, analyserRepo as any, store as any, vcsFor as any, new PullRequestAnalysisComment(), spend as any, admission as any, undefined, undefined, pulls as any)

    const doneRow = (over: Record<string, unknown> = {}) => ({
        id: "task-1", projectId: "proj-1", prNumber: 7, githubCommentId: null,
        reviewProfile: { kind: "default" }, headSha: "head1", pendingHeadSha: null, ...over,
    })
    const review = { summary: "s", impact: "i", findings: [], verdict: "approve", score: 10, score_max: 10 }

    test("a completed review is recorded as a round", async () => {
        store.findResultRow.mockResolvedValue(doneRow())
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await svcWithPulls().applyResult("task-1", "done", review as any, "https://app")

        expect(store.appendRound).toHaveBeenCalledTimes(1)
        expect(store.appendRound.mock.calls[0][0]).toMatchObject({ projectId: "proj-1", prNumber: 7, headSha: "head1" })
    })

    test("the next round starts when the PR moved while this one ran", async () => {
        store.findResultRow.mockResolvedValue(doneRow({ pendingHeadSha: "head2" }))
        projectsRepo.findGithubSyncContext.mockResolvedValue(project)
        pulls.findByNumber.mockResolvedValue({
            title: "T", body: null, state: "open", merged: false, head_sha: "head2", base_sha: "base2",
        })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await svcWithPulls().applyResult("task-1", "done", review as any, "https://app")

        // Cleared BEFORE the restart: a continuation that fails should leave the
        // PR needing another push, not spinning on a head it cannot review.
        expect(store.clearPendingHead).toHaveBeenCalledTimes(1)
        expect(analyser.startPRAnalysis).toHaveBeenCalledTimes(1)
    })

    test("no continuation when the head did not move", async () => {
        store.findResultRow.mockResolvedValue(doneRow({ pendingHeadSha: "head1" }))
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await svcWithPulls().applyResult("task-1", "done", review as any, "https://app")
        expect(analyser.startPRAnalysis).not.toHaveBeenCalled()
    })

    // A PR merged or closed during the review has nothing left to say, and
    // re-reviewing it would post onto a finished conversation.
    test("a PR closed during the review is not chased", async () => {
        store.findResultRow.mockResolvedValue(doneRow({ pendingHeadSha: "head2" }))
        projectsRepo.findGithubSyncContext.mockResolvedValue(project)
        pulls.findByNumber.mockResolvedValue({
            title: "T", body: null, state: "closed", merged: true, head_sha: "head2", base_sha: "b",
        })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await svcWithPulls().applyResult("task-1", "done", review as any, "https://app")
        expect(analyser.startPRAnalysis).not.toHaveBeenCalled()
    })

    test("a failed review records no round", async () => {
        store.findResultRow.mockResolvedValue(doneRow())
        await svcWithPulls().applyResult("task-1", "failed", null, "https://app")
        expect(store.appendRound).not.toHaveBeenCalled()
    })
})

// ─── incremental review (0081) ──────────────────────────────────────────────
//
// Two halves that have to agree: `start` decides the scope and writes down what
// it is carrying; `applyResult` merges that into the ONE findings list the merge
// gate counts. The tests below check the seam between them, because the pure
// arithmetic on either side is covered by ReviewScope/CarryForward's own suites
// and the failure this feature can actually produce is a decision that never
// reaches the callback.
describe("start — deciding the scope", () => {
    const blocker = {
        file: "src/untouched.ts", line: 3, severity: "critical", category: "bug",
        title: "unchecked owner on delete", detail: "any member can delete another's row",
    }
    const round = (over: Record<string, unknown> = {}) => ({
        headSha: "head0", round: 1, status: "done", verdict: "request_changes", score: 4, scoreMax: 10,
        findings: [blocker], degraded: false, reviewProfile: { kind: "default" }, analyserBuild: null,
        createdAt: "", scope: "full", scopeReason: null, prevHeadSha: null, baseSha: "base1",
        commits: [], carriedCount: 0, reviewedFiles: 3, resolved: [], ...over,
    })
    const compare = (over: Record<string, unknown> = {}) => ({
        status: "ahead",
        files: [{ filename: "src/touched.ts", status: "modified", patch: "@@\n+const x = 1", additions: 1, deletions: 0 }],
        commits: [{ sha: "head1", message: "fix(x): tighten the guard\n\nbody", author: "phongpak", committedAt: "2026-08-22T00:00:00Z" }],
        truncated: false,
        ...over,
    })

    test("a push after a clean round is scoped to the push", async () => {
        store.listRounds.mockResolvedValue([round()])
        vcsSvc.compareCommits.mockResolvedValue(compare())
        await svc().start(project, pr, "https://app")

        const scope = store.upsertTracking.mock.calls[0][0].reviewScope
        expect(scope.scope).toBe("incremental")
        expect(scope.reviewedFiles).toBe(1)
        // ONE file is reviewed, which is where the six minutes go. The pull
        // request's file list is still fetched — to widen that one file to its
        // whole-PR patch, so a file an earlier commit created is readable — but
        // the other eleven are never sent, never opened, and never re-derived.
        expect(analyser.startPRAnalysis.mock.calls[0][0].files).toHaveLength(1)
    })

    test("the untouched blocker is carried, not silently dropped", async () => {
        store.listRounds.mockResolvedValue([round()])
        vcsSvc.compareCommits.mockResolvedValue(compare())
        await svc().start(project, pr, "https://app")

        const scope = store.upsertTracking.mock.calls[0][0].reviewScope
        expect(scope.carried).toHaveLength(1)
        expect(scope.carried[0].title).toBe("unchecked owner on delete")
        // …and the reviewer is told not to re-report it.
        expect(analyser.startPRAnalysis.mock.calls[0][0].carried_findings).toHaveLength(1)
        expect(analyser.startPRAnalysis.mock.calls[0][0].review_scope).toMatchObject({ kind: "incremental" })
    })

    test("a blocker in a file the push touched goes back to be re-judged", async () => {
        store.listRounds.mockResolvedValue([round({ findings: [{ ...blocker, file: "src/touched.ts" }] })])
        vcsSvc.compareCommits.mockResolvedValue(compare())
        await svc().start(project, pr, "https://app")

        const scope = store.upsertTracking.mock.calls[0][0].reviewScope
        expect(scope.carried).toHaveLength(0)
        expect(analyser.startPRAnalysis.mock.calls[0][0].previous_blockers).toHaveLength(1)
    })

    test("a force-push carries nothing and reviews everything", async () => {
        store.listRounds.mockResolvedValue([round()])
        vcsSvc.compareCommits.mockResolvedValue(compare({ status: "diverged" }))
        await svc().start(project, pr, "https://app")

        const scope = store.upsertTracking.mock.calls[0][0].reviewScope
        expect(scope.scope).toBe("full")
        expect(scope.code).toBe("force_push")
        expect(scope.carried).toHaveLength(0)
        expect(vcsSvc.listPullRequestFiles).toHaveBeenCalledTimes(1)
    })

    test("a migration in the push forces a full pass", async () => {
        store.listRounds.mockResolvedValue([round()])
        vcsSvc.compareCommits.mockResolvedValue(
            compare({ files: [{ filename: "supabase/migrations/0082_x.sql", status: "added", patch: "@@", additions: 1, deletions: 0 }] }),
        )
        await svc().start(project, pr, "https://app")
        expect(store.upsertTracking.mock.calls[0][0].reviewScope.code).toBe("migration")
    })

    // The failure mode of the new machinery must be the OLD behaviour.
    test("a provider that cannot compare leaves the round full", async () => {
        store.listRounds.mockResolvedValue([round()])
        vcsSvc.compareCommits.mockRejectedValue(new Error("shallow mirror"))
        await svc().start(project, pr, "https://app")

        const scope = store.upsertTracking.mock.calls[0][0].reviewScope
        expect(scope.scope).toBe("full")
        expect(vcsSvc.listPullRequestFiles).toHaveBeenCalledTimes(1)
    })

    test("the commits behind the round are recorded even on a full first review", async () => {
        store.listRounds.mockResolvedValue([])
        vcsSvc.compareCommits.mockResolvedValue(compare())
        await svc().start(project, pr, "https://app")

        const scope = store.upsertTracking.mock.calls[0][0].reviewScope
        expect(scope.scope).toBe("full")
        expect(scope.commits).toEqual([
            { sha: "head1", subject: "fix(x): tighten the guard", author: "phongpak", at: "2026-08-22T00:00:00Z" },
        ])
    })
})

describe("applyResult — the merge", () => {
    const carried = {
        file: "src/untouched.ts", line: 3, severity: "critical", category: "bug",
        title: "unchecked owner on delete", detail: "any member can delete another's row",
    }
    const scopeRow = (over: Record<string, unknown> = {}) => ({
        scope: "incremental", code: "push_scoped", reason: "reviewing the 1 file this push changed",
        prevHeadSha: "head0", baseSha: "base1",
        commits: [{ sha: "head1", subject: "fix(x): tighten the guard", author: "p", at: null }],
        reviewedFiles: 1, carried: [carried], reJudgedBlockers: [], ...over,
    })
    const row = (over: Record<string, unknown> = {}) => ({
        id: "task-1", projectId: "proj-1", prNumber: 7, githubCommentId: null,
        reviewProfile: { kind: "default" }, headSha: "head1", pendingHeadSha: null,
        reviewScope: scopeRow(), ...over,
    })

    // THE failure this whole feature is built around: a carried blocker that
    // never reaches result.findings leaves the gate seeing zero criticals.
    test("a carried blocker reaches the list the merge gate counts", async () => {
        store.findResultRow.mockResolvedValue(row())
        store.listRounds.mockResolvedValue([])
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await svc().applyResult("task-1", "done", { summary: "s", impact: "i", findings: [] } as any, "https://app")

        const saved = store.saveResult.mock.calls.at(-1)![2]
        expect(saved.findings).toHaveLength(1)
        expect(saved.findings[0].provenance).toMatchObject({ carried: true })
    })

    test("the round records what it was scoped to and what it carried", async () => {
        store.findResultRow.mockResolvedValue(row())
        store.listRounds.mockResolvedValue([])
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await svc().applyResult("task-1", "done", { summary: "s", impact: "i", findings: [] } as any, "https://app")

        expect(store.appendRound.mock.calls[0][0]).toMatchObject({
            scope: "incremental",
            scopeReason: "reviewing the 1 file this push changed",
            prevHeadSha: "head0",
            carriedCount: 1,
            reviewedFiles: 1,
        })
        expect(store.appendRound.mock.calls[0][0].commits).toHaveLength(1)
    })

    // A run whose scope was never written down must not be recorded as a scoped
    // one: the reader of that row has to be able to trust "full".
    test("a run with no recorded scope records itself as full", async () => {
        store.findResultRow.mockResolvedValue(row({ reviewScope: null }))
        store.listRounds.mockResolvedValue([])
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await svc().applyResult("task-1", "done", { summary: "s", impact: "i", findings: [] } as any, "https://app")
        expect(store.appendRound.mock.calls[0][0]).toMatchObject({ scope: "full", carriedCount: 0 })
    })

    test("a full round still stamps provenance, so a later carried chip means something", async () => {
        store.findResultRow.mockResolvedValue(row({ reviewScope: scopeRow({ scope: "full", carried: [] }) }))
        store.listRounds.mockResolvedValue([])
        const found = { ...carried, file: "src/touched.ts" }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await svc().applyResult("task-1", "done", { summary: "s", impact: "i", findings: [found] } as any, "https://app")

        const saved = store.saveResult.mock.calls.at(-1)![2]
        expect(saved.findings[0].provenance).toMatchObject({ carried: false, lastVerifiedRound: 1, firstSeenRound: 1 })
    })

    test("a blocker the round did not report is recorded as resolved by this head", async () => {
        store.findResultRow.mockResolvedValue(row({ reviewScope: scopeRow({ carried: [] }) }))
        store.listRounds.mockResolvedValue([
            { headSha: "head0", round: 1, findings: [carried], degraded: false, reviewProfile: null, baseSha: "base1", scope: "full" },
        ])
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await svc().applyResult("task-1", "done", { summary: "s", impact: "i", findings: [] } as any, "https://app")

        const round = store.appendRound.mock.calls[0][0]
        expect(round.resolved).toHaveLength(1)
        expect(round.resolved[0].provenance.resolvedBy).toBe("head1")
        expect(round.result.findings).toHaveLength(0)
    })

    // A partial review read nothing, so its silence about a blocker is an
    // absence rather than a judgement.
    test("a degraded round puts back the re-judged blockers it never spoke about", async () => {
        store.findResultRow.mockResolvedValue(row({ reviewScope: scopeRow({ carried: [], reJudgedBlockers: [carried] }) }))
        store.listRounds.mockResolvedValue([])
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await svc().applyResult("task-1", "done", { summary: "s", impact: "i", findings: [], degraded: true } as any, "https://app")

        const saved = store.saveResult.mock.calls.at(-1)![2]
        expect(saved.findings).toHaveLength(1)
        expect(saved.findings[0].provenance.carried).toBe(true)
    })
})

// A cell deployed before incremental review REJECTS the request outright (the
// analyser decodes with DisallowUnknownFields). Without a fallback the row stays
// "analysing" and every pull request keeps a loading comment nothing comes back
// to edit, for the length of a partial deploy.
describe("start — an analyser that refuses the incremental request", () => {
    const blocker = {
        file: "src/untouched.ts", line: 3, severity: "critical", category: "bug",
        title: "unchecked owner on delete", detail: "any member can delete another's row",
    }

    beforeEach(() => {
        store.listRounds.mockResolvedValue([{
            headSha: "head0", round: 1, status: "done", verdict: "request_changes", score: 4, scoreMax: 10,
            findings: [blocker], degraded: false, reviewProfile: { kind: "default" }, analyserBuild: null,
            createdAt: "", scope: "full", scopeReason: null, prevHeadSha: null, baseSha: "base1",
            commits: [], carriedCount: 0, reviewedFiles: 3, resolved: [],
        }])
        vcsSvc.compareCommits.mockResolvedValue({
            status: "ahead",
            files: [{ filename: "src/touched.ts", status: "modified", patch: "@@\n+const x = 1", additions: 1, deletions: 0 }],
            commits: [],
            truncated: false,
        })
    })

    test("falls back to a full review rather than wedging the run", async () => {
        analyser.startPRAnalysis
            .mockRejectedValueOnce(new Error("pr/analyse/run failed: HTTP 400"))
            .mockResolvedValueOnce(undefined)
        await svc().start(project, pr, "https://app")

        expect(analyser.startPRAnalysis).toHaveBeenCalledTimes(2)
        const retry = analyser.startPRAnalysis.mock.calls[1][0]
        expect(retry.review_scope).toBeUndefined()
        expect(retry.carried_findings).toBeUndefined()
        // Twice: once to widen the incremental files to their whole-PR patches,
        // once for the full diff the retry sends.
        expect(vcsSvc.listPullRequestFiles).toHaveBeenCalledTimes(2)
        expect(retry.files.length).toBeGreaterThan(0)
    })

    // The row is what the callback merges from. A row still claiming to carry a
    // blocker the retry never sent would put it back into a review that did not
    // look at it — and label it verified.
    test("the row stops claiming to carry anything before the retry", async () => {
        analyser.startPRAnalysis
            .mockRejectedValueOnce(new Error("HTTP 400"))
            .mockResolvedValueOnce(undefined)
        await svc().start(project, pr, "https://app")

        const rewritten = store.upsertTracking.mock.calls.at(-1)![0].reviewScope
        expect(rewritten.scope).toBe("full")
        expect(rewritten.code).toBe("dispatch_refused")
        expect(rewritten.carried).toHaveLength(0)
    })

    test("a FULL dispatch that fails still throws — there is nothing to fall back to", async () => {
        vcsSvc.compareCommits.mockResolvedValue({ status: "diverged", files: [], commits: [], truncated: false })
        analyser.startPRAnalysis.mockRejectedValue(new Error("HTTP 500"))
        await expect(svc().start(project, pr, "https://app")).rejects.toThrow("HTTP 500")
        expect(analyser.startPRAnalysis).toHaveBeenCalledTimes(1)
    })
})

// The seam, end to end: what the callback STORES must not say "approve" over a
// findings list it just carried a blocker into.
describe("applyResult — the stored headline matches the stored findings", () => {
    const blocker = {
        file: "migrations/0011_webhooks.sql", line: 20, severity: "critical", category: "blast_radius",
        title: "Migration drops a column live code still reads",
        detail: "outbox-repo.ts still selects channel_id",
    }
    const row = {
        id: "task-1", projectId: "proj-1", prNumber: 4, githubCommentId: null,
        reviewProfile: { kind: "default" }, headSha: "59cb144", pendingHeadSha: null,
        reviewScope: {
            scope: "incremental", code: "push_scoped", reason: "reviewing the 3 files this push changed",
            prevHeadSha: "35fc8e7", baseSha: "base1", commits: [], reviewedFiles: 3,
            carried: [blocker], reJudgedBlockers: [],
        },
    }

    test("an approving reviewer over a carried blocker is stored as changes requested", async () => {
        store.findResultRow.mockResolvedValue(row)
        store.listRounds.mockResolvedValue([
            { headSha: "35fc8e7", round: 1, findings: [blocker], degraded: false, score: 1, reviewProfile: null, baseSha: "base1", scope: "full" },
        ])
        const clean = { summary: "s", impact: "i", findings: [], verdict: "approve", verdict_reason: "no risks found", score: 10, score_max: 10 }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await svc().applyResult("task-1", "done", clean as any, "https://app")

        const saved = store.saveResult.mock.calls.at(-1)![2]
        expect(saved.findings).toHaveLength(1)
        expect(saved.verdict).toBe("request_changes")
        expect(saved.verdict_reason).toContain("carried forward")
        // 10/10 beside a blocker is the "degraded review scoring 10/10" this
        // pipeline has been bitten by before.
        expect(saved.score).toBe(1)
    })

    test("a clean incremental round with nothing carried keeps the reviewer's verdict", async () => {
        store.findResultRow.mockResolvedValue({ ...row, reviewScope: { ...row.reviewScope, carried: [] } })
        store.listRounds.mockResolvedValue([])
        const clean = { summary: "s", impact: "i", findings: [], verdict: "approve", verdict_reason: "no risks found", score: 10, score_max: 10 }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await svc().applyResult("task-1", "done", clean as any, "https://app")

        const saved = store.saveResult.mock.calls.at(-1)![2]
        expect(saved.verdict).toBe("approve")
        expect(saved.verdict_reason).toBe("no risks found")
        expect(saved.score).toBe(10)
    })
})

// MR !4 round 4: three files in the push, zero findings, and an impact section
// asserting the changed modules "do not exist in the checkout". They existed —
// they were created earlier in the same pull request, and the reviewer's
// checkout is the default branch.
describe("start — an incremental round sends whole-PR content for the files it reviews", () => {
    const blocker = {
        file: "migrations/0011.sql", severity: "critical", category: "blast_radius",
        title: "drops a column live code reads", detail: "outbox-repo still selects it",
    }

    beforeEach(() => {
        store.listRounds.mockResolvedValue([{
            headSha: "head0", round: 1, status: "done", verdict: "request_changes", score: 3, scoreMax: 10,
            findings: [blocker], degraded: false, reviewProfile: { kind: "default" }, analyserBuild: null,
            createdAt: "", scope: "full", scopeReason: null, prevHeadSha: null, baseSha: "base1",
            commits: [], carriedCount: 0, reviewedFiles: 8, resolved: [],
        }])
        vcsSvc.compareCommits.mockResolvedValue({
            status: "ahead",
            files: [{ filename: "src/webhook-service.ts", status: "modified", patch: "@@ -60,1 +60,1 @@\n-old\n+new", additions: 1, deletions: 1 }],
            commits: [],
            truncated: false,
        })
        // The whole pull request: this file was CREATED by an earlier commit, so
        // its base…head patch is its entire content.
        vcsSvc.listPullRequestFiles.mockResolvedValue([
            { filename: "src/webhook-service.ts", status: "added", patch: "@@ -0,0 +1,80 @@\n+export async function fanout() {}\n+…", additions: 80, deletions: 0 },
            { filename: "migrations/0011.sql", status: "added", patch: "@@ +1,20 @@\n+drop column channel_id", additions: 20, deletions: 0 },
        ])
    })

    test("the file arrives with its whole-PR patch, not the push's hunks", async () => {
        await svc().start(project, pr, "https://app")
        const sent = analyser.startPRAnalysis.mock.calls[0][0]
        expect(sent.files).toHaveLength(1)
        expect(sent.files[0].patch).toContain("export async function fanout")
        expect(sent.files[0].status).toBe("added")
    })

    // The SCOPE is still the push. Widening the content must not widen the review.
    test("only the push's files are sent — the migration is carried, not reviewed", async () => {
        await svc().start(project, pr, "https://app")
        const sent = analyser.startPRAnalysis.mock.calls[0][0]
        expect(sent.files.map((f: { path: string }) => f.path)).toEqual(["src/webhook-service.ts"])
        expect(store.upsertTracking.mock.calls[0][0].reviewScope).toMatchObject({ scope: "incremental", reviewedFiles: 1 })
        expect(store.upsertTracking.mock.calls[0][0].reviewScope.carried).toHaveLength(1)
    })

    test("a provider that cannot list the pull request falls back to the push's patches", async () => {
        vcsSvc.listPullRequestFiles.mockRejectedValue(new Error("rate limited"))
        await svc().start(project, pr, "https://app")
        const sent = analyser.startPRAnalysis.mock.calls[0][0]
        expect(sent.files[0].patch).toContain("+new")
        expect(store.upsertTracking.mock.calls[0][0].reviewScope.scope).toBe("incremental")
    })
})

// MR !4 round 9: the push documented fanout's return contract — exactly what a
// carried finding was asking for — and the finding was CARRIED, because
// fanout's definition line had not changed, only the comment above it. The
// reviewer was shown the whole function and never asked about the finding.
describe("start — the carry symbol test reads the files as SENT", () => {
    const aboutFanout = {
        file: "src/workers/webhook-worker.ts",
        severity: "review",
        category: "correctness",
        title: "fanout return contract unverifiable",
        detail: "treats fanout's return as a per-row count and sums them; cannot confirm the contract",
    }

    beforeEach(() => {
        store.listRounds.mockResolvedValue([{
            headSha: "head0", round: 8, status: "done", verdict: "comment", score: 7, scoreMax: 10,
            findings: [aboutFanout], degraded: false, reviewProfile: { kind: "default" }, analyserBuild: null,
            createdAt: "", scope: "incremental", scopeReason: null, prevHeadSha: null, baseSha: "base1",
            commits: [], carriedCount: 3, reviewedFiles: 1, resolved: [],
        }])
        // The push edits only the comment above fanout — its definition line is
        // untouched, so the push-only diff contains no changed export at all.
        vcsSvc.compareCommits.mockResolvedValue({
            status: "ahead",
            files: [{
                filename: "src/notifications/app/webhook-service.ts",
                status: "modified",
                patch: "@@ -31,2 +31,3 @@\n-/** Deliver one event. */\n+/** Deliver one event.\n+ *  RETURNS THE NUMBER OF DELIVERY ATTEMPTS. */\n",
                additions: 2, deletions: 1,
            }],
            commits: [],
            truncated: false,
        })
        // …but the file is SENT with its whole-PR patch, which defines fanout.
        vcsSvc.listPullRequestFiles.mockResolvedValue([{
            filename: "src/notifications/app/webhook-service.ts",
            status: "added",
            patch: "@@ -0,0 +1,60 @@\n+export async function fanout(tenantId: string): Promise<number> {\n+  return 0\n+}\n",
            additions: 60, deletions: 0,
        }])
    })

    test("a finding naming a symbol the reviewer can now SEE is re-judged, not carried", async () => {
        await svc().start(project, pr, "https://app")
        const scope = store.upsertTracking.mock.calls[0][0].reviewScope
        expect(scope.scope).toBe("incremental")
        expect(scope.carried).toHaveLength(0)
    })

    // The scope decision still reads the PUSH — one file changed, not sixty.
    test("widening the symbol test does not widen the scope", async () => {
        await svc().start(project, pr, "https://app")
        const scope = store.upsertTracking.mock.calls[0][0].reviewScope
        expect(scope.reviewedFiles).toBe(1)
        expect(scope.code).toBe("push_scoped")
    })
})

// A degraded review is not a review — the grounded pass produced nothing
// parseable, so what gets stored is the reduce step's diff-level draft. On MR !4
// it overwrote a clean round 8 (7/10, no blockers) with a 2/10 partial.
describe("applyResult — a degraded review is retried, not shipped", () => {
    const svcWithPulls = () =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        new PullRequestAnalysisService(analyserFor as any, projectsRepo as any, analyserRepo as any, store as any, vcsFor as any, new PullRequestAnalysisComment(), spend as any, admission as any, undefined, undefined, pulls as any)

    const row = (over: Record<string, unknown> = {}) => ({
        id: "task-1", projectId: "proj-1", prNumber: 7, githubCommentId: null,
        reviewProfile: { kind: "default" }, headSha: "head1", pendingHeadSha: null, reviewScope: null, ...over,
    })
    const partial = { summary: "s", impact: "i", findings: [], verdict: "comment", degraded: true }
    const complete = { summary: "s", impact: "i", findings: [], verdict: "approve", degraded: false }

    const openPr = () => {
        projectsRepo.findGithubSyncContext.mockResolvedValue(project)
        pulls.findByNumber.mockResolvedValue({ title: "T", body: null, state: "open", merged: false, head_sha: "head1", base_sha: "base1" })
    }

    test("re-runs once at the same head", async () => {
        store.findResultRow.mockResolvedValue(row())
        store.listRounds.mockResolvedValue([])
        openPr()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await svcWithPulls().applyResult("task-1", "done", partial as any, "https://app")
        expect(analyser.startPRAnalysis).toHaveBeenCalledTimes(1)
    })

    // Without force the run-once-per-head gate would skip it — the head has not
    // moved. It is a retry of a review that did not happen.
    test("the retry is forced past the same-head skip", async () => {
        store.findResultRow.mockResolvedValue(row())
        store.listRounds.mockResolvedValue([])
        store.findTracking.mockResolvedValue({ id: "t", status: "done", githubCommentId: 1, headSha: "head1" })
        openPr()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await svcWithPulls().applyResult("task-1", "done", partial as any, "https://app")
        expect(analyser.startPRAnalysis).toHaveBeenCalledTimes(1)
    })

    test("a review that degrades twice at one head is left alone, not looped", async () => {
        store.findResultRow.mockResolvedValue(row())
        store.listRounds.mockResolvedValue([
            { headSha: "head1", round: 1, findings: [], degraded: true, reviewProfile: null, baseSha: "base1", scope: "full" },
        ])
        openPr()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await svcWithPulls().applyResult("task-1", "done", partial as any, "https://app")
        expect(analyser.startPRAnalysis).not.toHaveBeenCalled()
    })

    test("a completed review is never retried", async () => {
        store.findResultRow.mockResolvedValue(row())
        store.listRounds.mockResolvedValue([])
        openPr()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await svcWithPulls().applyResult("task-1", "done", complete as any, "https://app")
        expect(analyser.startPRAnalysis).not.toHaveBeenCalled()
    })

    // Newer code beats a second look at older code.
    test("a newer push wins — the pending head is chased instead of retrying", async () => {
        store.findResultRow.mockResolvedValue(row({ pendingHeadSha: "head2" }))
        store.listRounds.mockResolvedValue([])
        projectsRepo.findGithubSyncContext.mockResolvedValue(project)
        pulls.findByNumber.mockResolvedValue({ title: "T", body: null, state: "open", merged: false, head_sha: "head2", base_sha: "base1" })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await svcWithPulls().applyResult("task-1", "done", partial as any, "https://app")
        expect(store.clearPendingHead).toHaveBeenCalled()
        expect(analyser.startPRAnalysis.mock.calls[0][0].headSha).toBe("head2")
    })
})

// MR !4 rounds 10 and 11, same head: a degraded round was retried, and the retry
// of a ONE-FILE push reviewed all nine files, because the attempt it was
// retrying had failed. A bigger review for a failure that had nothing to do with
// size — which then failed too.
describe("start — a degraded round is skipped as a baseline, not escalated past", () => {
    const finding = { file: "src/a.ts", severity: "review", category: "bug", title: "still open", detail: "d" }
    const round = (n: number, degraded: boolean, head: string) => ({
        headSha: head, round: n, status: "done", verdict: "comment", score: 7, scoreMax: 10,
        findings: degraded ? [] : [finding], degraded, reviewProfile: { kind: "default" }, analyserBuild: null,
        createdAt: "", scope: "incremental", scopeReason: null, prevHeadSha: null, baseSha: "base1",
        commits: [], carriedCount: 0, reviewedFiles: 1, resolved: [],
    })

    beforeEach(() => {
        vcsSvc.compareCommits.mockResolvedValue({
            status: "ahead",
            files: [{ filename: "src/touched.ts", status: "modified", patch: "@@\n+const x = 1", additions: 1, deletions: 0 }],
            commits: [],
            truncated: false,
        })
        vcsSvc.listPullRequestFiles.mockResolvedValue([
            { filename: "src/touched.ts", status: "modified", patch: "@@\n+const x = 1", additions: 1, deletions: 0 },
        ])
    })

    test("baselines on the newest COMPLETED round rather than reviewing everything", async () => {
        // newest first: a degraded round sits on top of a good one
        store.listRounds.mockResolvedValue([round(10, true, "head9"), round(9, false, "head8")])
        await svc().start(project, pr, "https://app")

        const scope = store.upsertTracking.mock.calls[0][0].reviewScope
        expect(scope.scope).toBe("incremental")
        expect(scope.prevHeadSha).toBe("head8")
        expect(scope.carried).toHaveLength(1)
    })

    // The compare starts from the completed round's head, so everything the
    // pushes in between touched is re-judged by the ordinary carry rule.
    test("the compare range starts at the completed round's head", async () => {
        store.listRounds.mockResolvedValue([round(10, true, "head9"), round(9, false, "head8")])
        await svc().start(project, pr, "https://app")
        expect(vcsSvc.compareCommits.mock.calls[0][0]).toBe("head8")
    })

    test("nothing but degraded rounds is still a first review", async () => {
        store.listRounds.mockResolvedValue([round(10, true, "head9"), round(9, true, "head8")])
        await svc().start(project, pr, "https://app")
        expect(store.upsertTracking.mock.calls[0][0].reviewScope.code).toBe("first_round")
    })
})

// End-to-end on the REAL shape of MR !4 round 13: the push spans three commits,
// webhook-service.ts is in it, and it imports fanout.ts and webhook-signature.ts
// — both added earlier in the same pull request and therefore absent from the
// reviewer's checkout. This asserts what actually crosses the wire, because
// every previous confirmation of this was a review's prose and prose has been
// wrong about it four times.
describe("start — the wire payload actually carries the imported files", () => {
    const SERVICE = "src/notifications/app/webhook-service.ts"
    const FANOUT = "src/notifications/domain/fanout.ts"
    const SIGNATURE = "src/shared/webhook-signature.ts"
    const TEST = "src/shared/webhook-signature.test.ts"

    // The real import block, verbatim from the sandbox.
    const serviceImports =
        '+import { post } from "../../infra/http/client.js"\n' +
        '+import { deriveSecret, signatureHeaders } from "../../shared/webhook-signature.js"\n' +
        '+import { afterAttempt, isDue, matches, shouldDisable, type Subscription } from "../domain/fanout.js"\n'

    beforeEach(() => {
        store.listRounds.mockResolvedValue([{
            headSha: "b4da6ec", round: 8, status: "done", verdict: "comment", score: 7, scoreMax: 10,
            findings: [], degraded: false, reviewProfile: { kind: "default" }, analyserBuild: null,
            createdAt: "", scope: "incremental", scopeReason: null, prevHeadSha: null, baseSha: "base1",
            commits: [], carriedCount: 3, reviewedFiles: 1, resolved: [],
        }])
        vcsSvc.compareCommits.mockResolvedValue({
            status: "ahead",
            files: [
                { filename: SERVICE, status: "modified", patch: "@@ -30,1 +30,2 @@\n-old\n+new", additions: 2, deletions: 1 },
                { filename: TEST, status: "added", patch: '@@ -0,0 +1,5 @@\n+import { verify } from "./webhook-signature.js"\n', additions: 5, deletions: 0 },
            ],
            commits: [],
            truncated: false,
        })
        vcsSvc.listPullRequestFiles.mockResolvedValue([
            { filename: SERVICE, status: "added", patch: "@@ -0,0 +1,80 @@\n" + serviceImports + "+export async function fanout() { return 0 }\n", additions: 80, deletions: 0 },
            { filename: FANOUT, status: "added", patch: "@@ -0,0 +1,40 @@\n+export function afterAttempt() {}\n+export function shouldDisable() {}\n", additions: 40, deletions: 0 },
            { filename: SIGNATURE, status: "added", patch: "@@ -0,0 +1,45 @@\n+export function verify() { return true }\n", additions: 45, deletions: 0 },
            { filename: TEST, status: "added", patch: "@@ -0,0 +1,5 @@\n+import x\n", additions: 5, deletions: 0 },
        ])
    })

    test("fanout.ts and webhook-signature.ts arrive in pr_files WITH their bodies", async () => {
        await svc().start(project, pr, "https://app")
        const sent = analyser.startPRAnalysis.mock.calls[0][0]

        const byPath = new Map(sent.pr_files.map((f: { path: string; patch?: string }) => [f.path, f]))
        expect(byPath.get(FANOUT)?.patch).toContain("export function afterAttempt")
        expect(byPath.get(SIGNATURE)?.patch).toContain("export function verify")
    })

    test("files already in the push carry no duplicate body in the manifest", async () => {
        await svc().start(project, pr, "https://app")
        const sent = analyser.startPRAnalysis.mock.calls[0][0]
        const byPath = new Map(sent.pr_files.map((f: { path: string; patch?: string }) => [f.path, f]))
        // Both are reviewed files — they carry their patches in `files`, and
        // repeating them here would send the same bytes twice.
        expect(byPath.get(SERVICE)?.patch).toBeUndefined()
        expect(byPath.get(TEST)?.patch).toBeUndefined()
    })

    test("the manifest still names every file the pull request touches", async () => {
        await svc().start(project, pr, "https://app")
        const paths = analyser.startPRAnalysis.mock.calls[0][0].pr_files.map((f: { path: string }) => f.path)
        expect(paths.sort()).toEqual([FANOUT, SERVICE, SIGNATURE, TEST].sort())
    })

    test("and the round is still scoped to the push, not to the manifest", async () => {
        await svc().start(project, pr, "https://app")
        const sent = analyser.startPRAnalysis.mock.calls[0][0]
        expect(sent.files.map((f: { path: string }) => f.path).sort()).toEqual([SERVICE, TEST].sort())
        expect(sent.review_scope).toMatchObject({ kind: "incremental" })
    })
})
