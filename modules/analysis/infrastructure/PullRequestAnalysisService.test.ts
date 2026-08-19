// Characterization tests for the PR-review kickoff — the branching that decides
// whether a `pull_request` event actually costs an analyser run. Collaborators
// arrive by CONSTRUCTOR (DI), so plain mocks stand in for the leaf boundaries
// while the PURE entities (Project, ProjectAnalyser) stay real so the genuine
// readiness gates run.

import { test, expect, describe, mock, beforeAll, beforeEach } from "bun:test"
import { Project as RealProject } from "@/modules/projects/domain/Project"
import { PullRequestAnalysisComment } from "./PullRequestAnalysisComment"

const store = { findTracking: mock(), upsertTracking: mock(), findResultRow: mock(), saveResult: mock() }
const projectsRepo = { findCell: mock(), findGithubSyncContext: mock(), findTeamId: mock(async () => "team-1") }
const analyserRepo = { findReadiness: mock() }
const analyser = { startPRAnalysis: mock(), cancelPRAnalysis: mock() }
const analyserFor = mock(() => analyser)
const vcsSvc = { listPullRequestFiles: mock(), postPrComment: mock(), updatePrComment: mock() }
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const svc = () => new PullRequestAnalysisService(analyserFor as any, projectsRepo as any, analyserRepo as any, store as any, vcsFor as any, new PullRequestAnalysisComment(), spend as any)

beforeEach(() => {
    store.findTracking.mockReset().mockResolvedValue(null)
    store.upsertTracking.mockReset().mockResolvedValue({ id: "task-1" })
    projectsRepo.findCell.mockReset().mockResolvedValue("ashburn-0")
    analyserRepo.findReadiness.mockReset().mockResolvedValue({ enabled: true, status: "ready", graph_id: "G1" })
    analyser.startPRAnalysis.mockReset().mockResolvedValue(undefined)
    analyserFor.mockClear()
    vcsSvc.listPullRequestFiles.mockReset().mockResolvedValue([{ filename: "a.ts", status: "modified", patch: "@@", additions: 1, deletions: 0 }])
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
