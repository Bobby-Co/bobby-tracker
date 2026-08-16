// Characterization tests for the auto-analysis service — the durable analyser
// lifecycle. Pins the branching that lives only in this service: one-shot
// idempotency, the readiness gate, and the comment gating. The service takes its
// collaborators by CONSTRUCTOR (DI), so we inject plain mocks for the leaf
// boundaries (issue store, repos, analyser, and the vcs comment resolver) and keep
// the PURE entities (Project, ProjectAnalyser) real so the real gate rules run.

import { test, expect, describe, mock, beforeAll, beforeEach } from "bun:test"
import { Issue as RealIssue } from "@/modules/issues/domain/Issue"
import { Project as RealProject } from "@/modules/projects/domain/Project"
import { IssueAnalysisComment } from "./IssueAnalysisComment"

// ── injected collaborator mocks (stable refs) ─────────────────────────────────
const store = {
    findAnalysisRow: mock(),
    countSuggestions: mock(),
    updateSyncFields: mock(),
    insertSuggestion: mock(),
}
const projectsRepo = { findAnalysisContext: mock(), findCell: mock() }
const analyserRepo = { findByProjectId: mock(), findGraphId: mock() }
const analyser = { startIssueAnalysis: mock(), cancelIssueAnalysis: mock() }
// Cell → Analyser resolver (0062). The service learns the cell mid-flow, so
// it takes this rather than a fixed Analyser; returning the same mock for every
// cell keeps these characterization tests about lifecycle, not routing.
const analyserFor = mock(() => analyser)
// The vcs comment service the flow posts through (VcsAppService), via the resolver.
const vcsSvc = { postComment: mock(), updateComment: mock() }
const vcsFor = () => vcsSvc

// The service imports Project at module load, and the comment builder + prompt
// come in via the constructor (stubbed below). bun's mock.module is process-
// global, so these are supersets covering what sibling test files rely on.
mock.module("@/modules/issues", () => ({
    Issue: RealIssue,
    createServiceIssueSyncStore: () => store,
}))
const prompt = { compose: () => "FIX_PROMPT" }
mock.module("@/modules/projects", () => ({
    Project: RealProject,
    createSupabaseProjectsRepository: () => projectsRepo,
}))

let IssueAnalysisService: typeof import("./IssueAnalysisService").IssueAnalysisService
beforeAll(async () => {
    ;({ IssueAnalysisService } = await import("./IssueAnalysisService"))
})

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const svc = () => new IssueAnalysisService(analyserFor as any, store as any, projectsRepo as any, analyserRepo as any, vcsFor as any, new IssueAnalysisComment(), prompt as any)

beforeEach(() => {
    store.findAnalysisRow.mockReset().mockResolvedValue(null)
    store.countSuggestions.mockReset().mockResolvedValue(0)
    store.updateSyncFields.mockReset().mockResolvedValue(undefined)
    store.insertSuggestion.mockReset().mockResolvedValue(undefined)
    projectsRepo.findAnalysisContext.mockReset().mockResolvedValue(null)
    projectsRepo.findCell.mockReset().mockResolvedValue("ashburn-0")
    analyserFor.mockClear()
    analyserRepo.findByProjectId.mockReset().mockResolvedValue(null)
    analyserRepo.findGraphId.mockReset().mockResolvedValue("G1")
    analyser.startIssueAnalysis.mockReset().mockResolvedValue(undefined)
    analyser.cancelIssueAnalysis.mockReset().mockResolvedValue(undefined)
    vcsSvc.postComment.mockReset().mockResolvedValue({ id: 5001 })
    vcsSvc.updateComment.mockReset().mockResolvedValue(undefined)
})

// ── fixtures ──────────────────────────────────────────────────────────────────
const analysisRow = {
    id: "iss-1",
    project_id: "proj-1",
    issue_number: 7,
    title: "T",
    body: "B",
    status: "open",
    priority: "medium",
    labels: [],
    github_issue_number: 42,
    github_analysis_comment_id: null,
    analysis_status: null,
}
const readyAnalyser = { enabled: true, status: "ready", graph_id: "G1" }
const analysisProject = {
    name: "P",
    repo_url: null,
    repo_full_name: "acme/widgets",
    description: null,
    github_installation_id: 77,
    github_repo_id: 88,
    github_sync_enabled: true,
}

// ── auto-analysis kickoff (idempotency + comment gating) ────────────────────────
describe("ensure — one-shot idempotency + gates", () => {
    test("no issue row → 'no_issue' and no run", async () => {
        store.findAnalysisRow.mockResolvedValue(null)
        expect(await svc().ensure("iss-1", "https://app")).toBe("no_issue")
        expect(analyser.startIssueAnalysis).not.toHaveBeenCalled()
    })
    test("a RECENT run in flight → 'in_flight', never starts a second run", async () => {
        store.findAnalysisRow.mockResolvedValue({
            ...analysisRow,
            analysis_status: "analysing",
            analysis_started_at: new Date(Date.now() - 60_000).toISOString(),
        })
        expect(await svc().ensure("iss-1", "https://app")).toBe("in_flight")
        expect(analyser.startIssueAnalysis).not.toHaveBeenCalled()
    })

    // The wedge this exists to break: the status is written before dispatch and
    // only the callback clears it, so a lost callback used to mean the issue
    // could never be analysed again.
    test("an ABANDONED run does not block a retry", async () => {
        store.findAnalysisRow.mockResolvedValue({
            ...analysisRow,
            analysis_status: "analysing",
            analysis_started_at: new Date(Date.now() - 60 * 60_000).toISOString(),
        })
        analyserRepo.findByProjectId.mockResolvedValue(readyAnalyser)
        expect(await svc().ensure("iss-1", "https://app")).toBe("started")
        expect(analyser.startIssueAnalysis).toHaveBeenCalledTimes(1)
    })

    test("an in-flight run with NO start time retries — pre-0071 rows self-heal", async () => {
        store.findAnalysisRow.mockResolvedValue({
            ...analysisRow,
            analysis_status: "analysing",
            analysis_started_at: null,
        })
        analyserRepo.findByProjectId.mockResolvedValue(readyAnalyser)
        expect(await svc().ensure("iss-1", "https://app")).toBe("started")
        expect(analyser.startIssueAnalysis).toHaveBeenCalledTimes(1)
    })

    test("dispatch stamps analysis_started_at alongside the status", async () => {
        store.findAnalysisRow.mockResolvedValue(analysisRow)
        analyserRepo.findByProjectId.mockResolvedValue(readyAnalyser)
        await svc().ensure("iss-1", "https://app")
        const [, update] = store.updateSyncFields.mock.calls[0]
        expect(update.analysis_status).toBe("analysing")
        expect(Date.parse(update.analysis_started_at as string)).not.toBeNaN()
    })
    test("a suggestion already cached → 'done', never re-runs", async () => {
        store.findAnalysisRow.mockResolvedValue(analysisRow)
        store.countSuggestions.mockResolvedValue(1)
        expect(await svc().ensure("iss-1", "https://app")).toBe("done")
        expect(analyser.startIssueAnalysis).not.toHaveBeenCalled()
    })
    test("analyser not indexed → 'not_ready', no run", async () => {
        store.findAnalysisRow.mockResolvedValue(analysisRow)
        analyserRepo.findByProjectId.mockResolvedValue({ enabled: true, status: "indexing", graph_id: null })
        expect(await svc().ensure("iss-1", "https://app")).toBe("not_ready")
        expect(analyser.startIssueAnalysis).not.toHaveBeenCalled()
    })
    test("ready + linked → posts placeholder comment via vcs, marks analysing, starts run", async () => {
        store.findAnalysisRow.mockResolvedValue(analysisRow)
        analyserRepo.findByProjectId.mockResolvedValue(readyAnalyser)
        projectsRepo.findAnalysisContext.mockResolvedValue(analysisProject)

        expect(await svc().ensure("iss-1", "https://app")).toBe("started")
        expect(vcsSvc.postComment).toHaveBeenCalledTimes(1)
        // marks in-flight AND records the placeholder comment id it just created
        const [, update] = store.updateSyncFields.mock.calls[0]
        expect(update).toMatchObject({ analysis_status: "analysing", github_analysis_comment_id: 5001 })
        expect(analyser.startIssueAnalysis.mock.calls[0][0]).toMatchObject({ repoId: "G1" })
    })
    test("web-only project (no repo link) → still starts, but posts NO comment", async () => {
        store.findAnalysisRow.mockResolvedValue(analysisRow)
        analyserRepo.findByProjectId.mockResolvedValue(readyAnalyser)
        projectsRepo.findAnalysisContext.mockResolvedValue(null)

        expect(await svc().ensure("iss-1", "https://app")).toBe("started")
        expect(vcsSvc.postComment).not.toHaveBeenCalled()
        expect(analyser.startIssueAnalysis).toHaveBeenCalledTimes(1)
    })
})

// ── analyser callback ───────────────────────────────────────────────────────────
describe("applyResult", () => {
    const row = { ...analysisRow, github_analysis_comment_id: 5001, analysis_status: "analysing" }
    const result = { markdown: "done", summary: "s", suggestions: [], graph_cites: [], confidence: 0.9, cost_usd: 1, duration_ms: 10 }

    test("unknown task id → no-op", async () => {
        store.findAnalysisRow.mockResolvedValue(null)
        await svc().applyResult("nope", "done", result as never, "https://app")
        expect(store.updateSyncFields).not.toHaveBeenCalled()
    })
    test("done → edits placeholder comment via vcs, records status, caches the suggestion", async () => {
        store.findAnalysisRow.mockResolvedValue(row)
        projectsRepo.findAnalysisContext.mockResolvedValue(analysisProject)
        await svc().applyResult("iss-1", "done", result as never, "https://app")
        expect(vcsSvc.updateComment).toHaveBeenCalledTimes(1)
        expect(store.updateSyncFields).toHaveBeenCalledWith("iss-1", { analysis_status: "done" })
        expect(store.insertSuggestion).toHaveBeenCalledTimes(1)
    })
    test("failed → records status but caches NO suggestion", async () => {
        store.findAnalysisRow.mockResolvedValue(row)
        projectsRepo.findAnalysisContext.mockResolvedValue(analysisProject)
        await svc().applyResult("iss-1", "failed", null, "https://app")
        expect(store.updateSyncFields).toHaveBeenCalledWith("iss-1", { analysis_status: "failed" })
        expect(store.insertSuggestion).not.toHaveBeenCalled()
    })
})

// ── cancel ────────────────────────────────────────────────────────────────────
describe("cancel", () => {
    test("delegates to the analyser's cancel", async () => {
        store.findAnalysisRow.mockResolvedValue(analysisRow)
        await svc().cancel("iss-1")
        expect(analyser.cancelIssueAnalysis).toHaveBeenCalledWith("iss-1")
    })

    // Since 0062 a cancel has to reach the analyser actually running the task, so
    // it resolves the issue's project cell first. Both lookups fail closed —
    // silently, because cancel is best-effort by contract.
    test("routes the cancel to the project's cell", async () => {
        store.findAnalysisRow.mockResolvedValue(analysisRow)
        projectsRepo.findCell.mockResolvedValue("bangkok-0")
        await svc().cancel("iss-1")
        expect(analyserFor).toHaveBeenCalledWith("bangkok-0")
    })

    test("no-ops when the issue is gone", async () => {
        store.findAnalysisRow.mockResolvedValue(null)
        await svc().cancel("iss-1")
        expect(analyser.cancelIssueAnalysis).not.toHaveBeenCalled()
    })

    test("no-ops rather than guessing when the cell is unreadable", async () => {
        store.findAnalysisRow.mockResolvedValue(analysisRow)
        projectsRepo.findCell.mockResolvedValue(null)
        await svc().cancel("iss-1")
        expect(analyser.cancelIssueAnalysis).not.toHaveBeenCalled()
    })
})
