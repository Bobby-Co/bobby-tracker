// Characterization tests for the issue-sync USE-CASES — the orchestration the
// issue routes + webhook call (outbound push/update/delete + hard-sync backfill).
//
// After the VCS-module refactor the shims are gone: routes call VcsAppService
// directly (and importExistingIssues from the composition root). The remote is
// the VcsAppInstance port, so we mock its GitHub adapter (createGithubVcsAppInstance)
// with a fake instance and assert the SERVICE hits the right port methods with
// vendor-neutral args. We keep the PURE entities (Issue, Project) real so the real
// gate rules are exercised. (The adapter's own REST/GraphQL mapping + the
// graphql-then-close delete fallback are covered where that code lives, not here.)

import { test, expect, describe, mock, beforeAll, beforeEach } from "bun:test"
import { Issue as RealIssue } from "@/modules/issues/domain/Issue"
import { Project as RealProject } from "@/modules/projects/domain/project"

// ── leaf mocks ─────────────────────────────────────────────────────────────────
const store = {
    findIssueAnalysisRow: mock(),
    countIssueSuggestions: mock(),
    updateIssueSyncFields: mock(),
    insertImportedIssue: mock(),
    insertIssueSuggestion: mock(),
    listLinkedGithubNumbers: mock(),
}
const projectsRepo = { findGithubSyncContext: mock() }

// The remote seam: the app-authority instance the composition resolves.
const instance = {
    createIssue: mock(),
    updateIssue: mock(),
    deleteIssue: mock(),
    listIssues: mock(),
}

// Composition news up GithubVcsAppInstance; a constructor that returns our fake
// instance object stands in for it (a JS constructor may return an object).
mock.module("./GithubVcsAppInstance", () => ({
    GithubVcsAppInstance: class {
        constructor() {
            return instance
        }
    },
}))
mock.module("@/lib/server/supabase", () => ({ Supabase: { service: () => ({}) } }))
const SVC = {}
mock.module("@/modules/issues", () => ({
    Issue: RealIssue,
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

// The issue-sync shims were deleted; the routes now call VcsAppService directly
// (and importExistingIssues from composition). This wrapper keeps the existing
// call sites while exercising exactly that path through the composition.
/* eslint-disable @typescript-eslint/no-explicit-any */
let comp: typeof import("../Composition")
beforeAll(async () => {
    comp = await import("../Composition")
})
const sync = {
    pushIssueToGithub: (i: any, p: any) => comp.getVcsAppService(p)?.syncIssueCreated(i, p) ?? Promise.resolve(),
    updateGithubIssueFromTracker: (i: any, p: any, c: any) =>
        comp.getVcsAppService(p)?.syncIssueUpdated(i, p, c) ?? Promise.resolve(),
    deleteGithubIssueFromTracker: (i: any, p: any) => comp.getVcsAppService(p)?.syncIssueDeleted(i, p) ?? Promise.resolve(),
    importExistingIssues: (id: string) => comp.importExistingIssues(id),
}
/* eslint-enable @typescript-eslint/no-explicit-any */

beforeEach(() => {
    instance.createIssue.mockReset().mockResolvedValue({ number: 101, nodeId: "N101" })
    instance.updateIssue.mockReset().mockResolvedValue(undefined)
    instance.deleteIssue.mockReset().mockResolvedValue(undefined)
    instance.listIssues.mockReset().mockResolvedValue([])
    store.findIssueAnalysisRow.mockReset().mockResolvedValue(null)
    store.countIssueSuggestions.mockReset().mockResolvedValue(0)
    store.updateIssueSyncFields.mockReset().mockResolvedValue(undefined)
    store.insertImportedIssue.mockReset().mockResolvedValue(true)
    store.insertIssueSuggestion.mockReset().mockResolvedValue(undefined)
    store.listLinkedGithubNumbers.mockReset().mockResolvedValue([])
    projectsRepo.findGithubSyncContext.mockReset().mockResolvedValue(null)
})

// ── fixtures ───────────────────────────────────────────────────────────────────
const wiredProject = {
    repo_url: null,
    repo_full_name: "acme/widgets",
    github_installation_id: 77,
    github_repo_id: 88,
    github_sync_enabled: true,
    github_sync_direction: "both" as const,
    github_sync_deletes: false,
}
const anIssue = {
    id: "iss-1",
    title: "Title",
    body: "Body",
    status: "open" as const,
    priority: "medium",
    labels: [] as string[],
    github_issue_number: null as number | null,
    github_node_id: null as string | null,
}

// ── outbound: create ───────────────────────────────────────────────────────────
describe("pushIssueToGithub", () => {
    test("no-op when sync isn't fully wired (no remote call, no write-back)", async () => {
        await sync.pushIssueToGithub(anIssue, { ...wiredProject, github_sync_enabled: false })
        expect(instance.createIssue).not.toHaveBeenCalled()
        expect(store.updateIssueSyncFields).not.toHaveBeenCalled()
    })
    test("no-op when direction forbids outbound (inbound-only)", async () => {
        await sync.pushIssueToGithub(anIssue, { ...wiredProject, github_sync_direction: "inbound" })
        expect(instance.createIssue).not.toHaveBeenCalled()
    })
    test("creates the issue and writes number/node_id + sync bookkeeping back", async () => {
        await sync.pushIssueToGithub(anIssue, wiredProject)
        expect(instance.createIssue).toHaveBeenCalledWith({ title: "Title", body: "Body" })
        const [, , patch] = store.updateIssueSyncFields.mock.calls[0]
        expect(patch).toMatchObject({ github_issue_number: 101, github_node_id: "N101", sync_source: "tracker" })
        expect(patch.last_synced_hash).toMatch(/^[0-9a-f]{64}$/)
    })
})

// ── outbound: update (patch-subset + empty-patch no-op) ─────────────────────────
describe("updateGithubIssueFromTracker", () => {
    const linked = { ...anIssue, github_issue_number: 101, github_node_id: "N101" }

    test("no-op when the issue isn't linked to a number", async () => {
        await sync.updateGithubIssueFromTracker(anIssue, wiredProject, { title: true })
        expect(instance.updateIssue).not.toHaveBeenCalled()
    })
    test("nothing changed → no remote call and no bookkeeping write", async () => {
        await sync.updateGithubIssueFromTracker(linked, wiredProject, {})
        expect(instance.updateIssue).not.toHaveBeenCalled()
        expect(store.updateIssueSyncFields).not.toHaveBeenCalled()
    })
    test("sends only the changed subset — status maps to a GitHub state", async () => {
        await sync.updateGithubIssueFromTracker({ ...linked, status: "done" }, wiredProject, { status: true })
        expect(instance.updateIssue).toHaveBeenCalledWith(101, { state: "closed" })
    })
    test("title-only edit sends just the title", async () => {
        await sync.updateGithubIssueFromTracker({ ...linked, title: "New" }, wiredProject, { title: true })
        expect(instance.updateIssue).toHaveBeenCalledWith(101, { title: "New" })
    })
})

// ── outbound: delete (delegates the ids; the fallback is the adapter's job) ─────
describe("deleteGithubIssueFromTracker", () => {
    const linked = { ...anIssue, github_issue_number: 101, github_node_id: "N101" }
    const delProject = { ...wiredProject, github_sync_deletes: true }

    test("no-op when delete-propagation is off", async () => {
        await sync.deleteGithubIssueFromTracker(linked, wiredProject)
        expect(instance.deleteIssue).not.toHaveBeenCalled()
    })
    test("deletes with both ids when linked (adapter decides graphql-vs-close)", async () => {
        await sync.deleteGithubIssueFromTracker(linked, delProject)
        expect(instance.deleteIssue).toHaveBeenCalledWith({ number: 101, nodeId: "N101" })
    })
    test("passes a null node id through (adapter goes straight to close)", async () => {
        await sync.deleteGithubIssueFromTracker({ ...linked, github_node_id: null }, delProject)
        expect(instance.deleteIssue).toHaveBeenCalledWith({ number: 101, nodeId: null })
    })
})

// ── hard sync (backfill) — gate + idempotent dedup ──────────────────────────────
describe("importExistingIssues", () => {
    const syncCtx = { ...wiredProject, id: "proj-1", user_id: "user-1" }

    test("no-op (zeroes) when the project isn't wired for inbound sync", async () => {
        projectsRepo.findGithubSyncContext.mockResolvedValue({ ...syncCtx, github_sync_direction: "outbound" })
        expect(await sync.importExistingIssues("proj-1")).toEqual({ imported: 0, total: 0, skipped: 0 })
        expect(instance.listIssues).not.toHaveBeenCalled()
    })
    test("imports the new ones and skips numbers already linked (idempotent re-run)", async () => {
        projectsRepo.findGithubSyncContext.mockResolvedValue(syncCtx)
        instance.listIssues.mockResolvedValue([
            { number: 1, nodeId: "n1", title: "one", body: "", state: "open" },
            { number: 2, nodeId: "n2", title: "two", body: "", state: "closed" },
        ])
        store.listLinkedGithubNumbers.mockResolvedValue([1]) // #1 already linked
        const out = await sync.importExistingIssues("proj-1")
        expect(out).toEqual({ imported: 1, total: 2, skipped: 1 })
        expect(store.insertImportedIssue).toHaveBeenCalledTimes(1)
        const [, inserted] = store.insertImportedIssue.mock.calls[0]
        // #2 was closed on GitHub → imported as tracker status "done"
        expect(inserted).toMatchObject({ github_issue_number: 2, status: "done", sync_source: "github" })
    })
})
