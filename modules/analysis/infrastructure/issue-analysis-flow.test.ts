// Characterization tests for the auto-analysis flow — the durable analyser
// lifecycle moved here from the vcs module. Pins the branching that lives only in
// these functions: one-shot idempotency, the readiness gate, and the comment
// gating. We mock the leaf boundaries (issue store, repos, getAnalyser, and the
// vcs comment service) and keep the PURE entities (Project, ProjectAnalyser) real
// so the real gate rules are exercised.

import { test, expect, describe, mock, beforeAll, beforeEach } from "bun:test"
import { Issue as RealIssue } from "@/modules/issues/domain/Issue"
import { Project as RealProject } from "@/modules/projects/domain/project"

// ── leaf mocks (stable refs) ──────────────────────────────────────────────────
const store = {
    findIssueAnalysisRow: mock(),
    countIssueSuggestions: mock(),
    updateIssueSyncFields: mock(),
    insertIssueSuggestion: mock(),
    // Not used by this flow, but bun's mock.module is process-global, so this
    // @/modules/issues mock must carry the full surface other test files rely on.
    insertImportedIssue: mock(),
    listLinkedGithubNumbers: mock(),
}
const SVC = {}
const projectsRepo = { findAnalysisContext: mock() }
const analyserRepo = { findByProjectId: mock(), findGraphId: mock() }
const analyser = { startIssueAnalysis: mock(), cancelIssueAnalysis: mock() }
// The vcs comment service the flow now posts through (VcsAppService).
const vcsSvc = { postComment: mock(), updateComment: mock() }

mock.module("@/lib/supabase/server", () => ({ createServiceClient: () => ({}) }))
mock.module("@/modules/issues", () => ({
    Issue: RealIssue,
    composeIssueFixPrompt: () => "FIX_PROMPT",
    upsertIssueComment: mock(),
    ...store,
    createServiceIssueSyncStore: () => ({
        findAnalysisRow: (id: string) => store.findIssueAnalysisRow(SVC, id),
        listLinkedGithubNumbers: (pid: string) => store.listLinkedGithubNumbers(SVC, pid),
        updateSyncFields: (id: string, patch: unknown) => store.updateIssueSyncFields(SVC, id, patch),
        insertImportedIssue: (row: unknown) => store.insertImportedIssue(SVC, row),
        countSuggestions: (id: string) => store.countIssueSuggestions(SVC, id),
        insertSuggestion: (row: unknown) => store.insertIssueSuggestion(SVC, row),
    }),
}))
mock.module("@/modules/projects", () => ({
    Project: RealProject,
    createSupabaseProjectsRepository: () => projectsRepo,
}))
// The comment renderer (issue-analysis-comment) also imports blobUrl from this
// barrel, so the mock must carry it (mock.module replaces the whole module).
mock.module("@/modules/vcs", () => ({
    getVcsAppService: () => vcsSvc,
    blobUrl: () => null,
    repoFullName: () => null,
}))
// The flow's own-module deps are imported relatively — mock those paths.
mock.module("../composition", () => ({ getAnalyser: () => analyser }))
mock.module("./supabase-project-analyser-repository", () => ({
    createSupabaseProjectAnalyserRepository: () => analyserRepo,
}))

let flow: typeof import("./issue-analysis-flow")
beforeAll(async () => {
    flow = await import("./issue-analysis-flow")
})

beforeEach(() => {
    store.findIssueAnalysisRow.mockReset().mockResolvedValue(null)
    store.countIssueSuggestions.mockReset().mockResolvedValue(0)
    store.updateIssueSyncFields.mockReset().mockResolvedValue(undefined)
    store.insertIssueSuggestion.mockReset().mockResolvedValue(undefined)
    projectsRepo.findAnalysisContext.mockReset().mockResolvedValue(null)
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
describe("ensureAnalysis — one-shot idempotency + gates", () => {
    test("no issue row → 'no_issue' and no run", async () => {
        store.findIssueAnalysisRow.mockResolvedValue(null)
        expect(await flow.ensureAnalysis("iss-1", "https://app")).toBe("no_issue")
        expect(analyser.startIssueAnalysis).not.toHaveBeenCalled()
    })
    test("already analysing → 'in_flight', never starts a second run", async () => {
        store.findIssueAnalysisRow.mockResolvedValue({ ...analysisRow, analysis_status: "analysing" })
        expect(await flow.ensureAnalysis("iss-1", "https://app")).toBe("in_flight")
        expect(analyser.startIssueAnalysis).not.toHaveBeenCalled()
    })
    test("a suggestion already cached → 'done', never re-runs", async () => {
        store.findIssueAnalysisRow.mockResolvedValue(analysisRow)
        store.countIssueSuggestions.mockResolvedValue(1)
        expect(await flow.ensureAnalysis("iss-1", "https://app")).toBe("done")
        expect(analyser.startIssueAnalysis).not.toHaveBeenCalled()
    })
    test("analyser not indexed → 'not_ready', no run", async () => {
        store.findIssueAnalysisRow.mockResolvedValue(analysisRow)
        analyserRepo.findByProjectId.mockResolvedValue({ enabled: true, status: "indexing", graph_id: null })
        expect(await flow.ensureAnalysis("iss-1", "https://app")).toBe("not_ready")
        expect(analyser.startIssueAnalysis).not.toHaveBeenCalled()
    })
    test("ready + linked → posts placeholder comment via vcs, marks analysing, starts run", async () => {
        store.findIssueAnalysisRow.mockResolvedValue(analysisRow)
        analyserRepo.findByProjectId.mockResolvedValue(readyAnalyser)
        projectsRepo.findAnalysisContext.mockResolvedValue(analysisProject)

        expect(await flow.ensureAnalysis("iss-1", "https://app")).toBe("started")
        expect(vcsSvc.postComment).toHaveBeenCalledTimes(1)
        // marks in-flight AND records the placeholder comment id it just created
        const [, , update] = store.updateIssueSyncFields.mock.calls[0]
        expect(update).toMatchObject({ analysis_status: "analysing", github_analysis_comment_id: 5001 })
        expect(analyser.startIssueAnalysis.mock.calls[0][0]).toMatchObject({ repoId: "G1" })
    })
    test("web-only project (no repo link) → still starts, but posts NO comment", async () => {
        store.findIssueAnalysisRow.mockResolvedValue(analysisRow)
        analyserRepo.findByProjectId.mockResolvedValue(readyAnalyser)
        projectsRepo.findAnalysisContext.mockResolvedValue(null)

        expect(await flow.ensureAnalysis("iss-1", "https://app")).toBe("started")
        expect(vcsSvc.postComment).not.toHaveBeenCalled()
        expect(analyser.startIssueAnalysis).toHaveBeenCalledTimes(1)
    })
})

// ── analyser callback ───────────────────────────────────────────────────────────
describe("applyAnalysisResult", () => {
    const row = { ...analysisRow, github_analysis_comment_id: 5001, analysis_status: "analysing" }
    const result = { markdown: "done", summary: "s", suggestions: [], graph_cites: [], confidence: 0.9, cost_usd: 1, duration_ms: 10 }

    test("unknown task id → no-op", async () => {
        store.findIssueAnalysisRow.mockResolvedValue(null)
        await flow.applyAnalysisResult("nope", "done", result as never, "https://app")
        expect(store.updateIssueSyncFields).not.toHaveBeenCalled()
    })
    test("done → edits placeholder comment via vcs, records status, caches the suggestion", async () => {
        store.findIssueAnalysisRow.mockResolvedValue(row)
        projectsRepo.findAnalysisContext.mockResolvedValue(analysisProject)
        await flow.applyAnalysisResult("iss-1", "done", result as never, "https://app")
        expect(vcsSvc.updateComment).toHaveBeenCalledTimes(1)
        expect(store.updateIssueSyncFields).toHaveBeenCalledWith(expect.anything(), "iss-1", { analysis_status: "done" })
        expect(store.insertIssueSuggestion).toHaveBeenCalledTimes(1)
    })
    test("failed → records status but caches NO suggestion", async () => {
        store.findIssueAnalysisRow.mockResolvedValue(row)
        projectsRepo.findAnalysisContext.mockResolvedValue(analysisProject)
        await flow.applyAnalysisResult("iss-1", "failed", null, "https://app")
        expect(store.updateIssueSyncFields).toHaveBeenCalledWith(expect.anything(), "iss-1", { analysis_status: "failed" })
        expect(store.insertIssueSuggestion).not.toHaveBeenCalled()
    })
})

// ── cancel ────────────────────────────────────────────────────────────────────
describe("cancelAnalysis", () => {
    test("delegates to the analyser's cancel", async () => {
        await flow.cancelAnalysis("iss-1")
        expect(analyser.cancelIssueAnalysis).toHaveBeenCalledWith("iss-1")
    })
})
