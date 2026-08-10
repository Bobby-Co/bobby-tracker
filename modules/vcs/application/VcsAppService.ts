// VCS application — VcsAppService: the provider-AGNOSTIC orchestrator for actions
// taken as the installed app/bot. It owns the two-way issue-sync use cases
// (create/update/delete/import) and the bot-comment primitives, expressed purely
// in terms of our domain (Issue, Project) + two ports:
//   • VcsAppInstance  — the remote (createIssue, updateIssue, …); vendor-neutral.
//   • IssueSyncStore  — our persistence of the sync bookkeeping (issues context).
// It handles NO tokens, owner/repo, REST/GraphQL, or DB SDK — those live in the
// adapters wired at the composition root (../composition.ts). This is what makes
// swapping GitHub for another provider a composition change, not a rewrite.
//
// Pure application: imports only domain + ports (enforced by the DIP lint rule).

import { Issue, type IssueStatusValue, type IssueSyncStore } from "@/modules/issues"
import { Project, type ProjectSyncState } from "@/modules/projects"
import { SyncHash } from "../domain/SyncHash"
import type { VcsAppInstance } from "../ports/VcsAppInstance"
import type {
    VcsMergeInput,
    VcsMergeMethods,
    VcsMergeResult,
    VcsMergeability,
    VcsPullRequestFile,
} from "../ports/VcsTypes"

/** The issue fields the sync use cases read. Structural (not the full Issue row)
 *  so a freshly-inserted/updated row can be passed straight in. */
export interface SyncIssueInput {
    id: string
    title: string
    body: string | null
    status: IssueStatusValue
    github_issue_number: number | null
    github_node_id: string | null
}

/** Which fields a tracker edit touched — only title/body/status mirror to the
 *  remote (never priority/labels). */
export interface IssueChangeSet {
    title?: boolean
    body?: boolean
    status?: boolean
}

/** The extra context an import needs to attribute the rows it creates. */
export interface ImportContext {
    projectId: string
    userId: string
}

export class VcsAppService {
    private readonly syncHash = new SyncHash()

    constructor(
        private readonly vcs: VcsAppInstance,
        private readonly sync: IssueSyncStore,
    ) {}

    // ─── outbound: create ───────────────────────────────────────────────────
    /** Mirror a newly-created tracker issue to the remote and write its number/
     *  node id + sync bookkeeping back BEFORE returning (writing last_synced_hash
     *  before the echoed `opened` webhook lands is the outbound loop-guard).
     *  No-op unless the project allows outbound. */
    async syncIssueCreated(issue: SyncIssueInput, project: ProjectSyncState): Promise<void> {
        const p = Project.of(project)
        if (!p.isSyncReady() || !p.allowsOutbound()) return

        const created = await this.vcs.createIssue({ title: issue.title, body: issue.body ?? "" })
        // The remote opens issues in `open`; hash against that so the echoed
        // `opened` webhook is recognised as ours.
        const hash = await this.syncHash.compute(issue.title, issue.body ?? "", "open")
        await this.sync.updateSyncFields(issue.id, {
            github_issue_number: created.number,
            github_node_id: created.nodeId,
            sync_source: "tracker",
            last_synced_hash: hash,
            github_synced_at: new Date().toISOString(),
        })
    }

    // ─── outbound: update ───────────────────────────────────────────────────
    /** Mirror a tracker edit to the remote, sending only the changed subset
     *  (title/body/status→state), then refresh the sync bookkeeping. No-op unless
     *  the issue is linked, the project allows outbound, and something relevant
     *  changed. */
    async syncIssueUpdated(issue: SyncIssueInput, project: ProjectSyncState, changed: IssueChangeSet): Promise<void> {
        const p = Project.of(project)
        if (!p.isSyncReady() || !p.allowsOutbound()) return
        if (issue.github_issue_number == null) return

        const state = Issue.of({ status: issue.status }).githubState()
        const patch: { title?: string; body?: string; state?: "open" | "closed" } = {}
        if (changed.title) patch.title = issue.title
        if (changed.body) patch.body = issue.body ?? ""
        if (changed.status) patch.state = state
        if (Object.keys(patch).length === 0) return

        await this.vcs.updateIssue(issue.github_issue_number, patch)
        const hash = await this.syncHash.compute(issue.title, issue.body ?? "", state)
        await this.sync.updateSyncFields(issue.id, {
            sync_source: "tracker",
            last_synced_hash: hash,
            github_synced_at: new Date().toISOString(),
        })
    }

    // ─── outbound: delete ────────────────────────────────────────────────────
    /** Delete (or close) the linked remote issue when a tracker issue is deleted
     *  and delete-propagation is on. The provider's delete-vs-close fallback is
     *  the adapter's concern. No-op unless outbound + deletes are enabled. */
    async syncIssueDeleted(issue: SyncIssueInput, project: ProjectSyncState): Promise<void> {
        const p = Project.of(project)
        if (!p.isSyncReady() || !p.allowsOutbound() || !p.propagatesDeletes()) return
        await this.vcs.deleteIssue({ number: issue.github_issue_number, nodeId: issue.github_node_id })
    }

    // ─── inbound: hard sync (backfill) ───────────────────────────────────────
    /** Pull all existing remote issues into the tracker. Idempotent — skips
     *  issues already linked by number. Does NOT auto-analyse each one (a repo can
     *  have hundreds). No-op unless the project allows inbound. */
    async importIssues(
        ctx: ImportContext,
        project: ProjectSyncState,
    ): Promise<{ imported: number; total: number; skipped: number }> {
        const p = Project.of(project)
        if (!p.isSyncReady() || !p.allowsInbound()) return { imported: 0, total: 0, skipped: 0 }

        const remote = await this.vcs.listIssues({ state: "all" })
        const seen = new Set(await this.sync.listLinkedGithubNumbers(ctx.projectId))

        let imported = 0
        let skipped = 0
        for (const it of remote) {
            if (seen.has(it.number)) {
                skipped++
                continue
            }
            const closed = it.state === "closed"
            const ok = await this.sync.insertImportedIssue({
                project_id: ctx.projectId,
                user_id: ctx.userId,
                title: it.title,
                body: it.body ?? "",
                status: Issue.statusFromGithubState(closed ? "closed" : "open"),
                github_issue_number: it.number,
                github_node_id: it.nodeId,
                sync_source: "github",
                last_synced_hash: await this.syncHash.compute(it.title, it.body ?? "", closed ? "closed" : "open"),
                github_synced_at: new Date().toISOString(),
            })
            if (ok) imported++
        }
        return { imported, total: remote.length, skipped }
    }

    // ─── bot comments (used by the analysis flows, which own the lifecycle) ───
    /** Post a bot comment on an issue/PR; returns its id so the caller can edit it
     *  in place later. */
    postComment(issueNumber: number, body: string): Promise<{ id: number }> {
        return this.vcs.createIssueComment(issueNumber, body)
    }

    /** Edit a bot comment in place. `issueNumber` scopes it (GitLab needs it). */
    updateComment(issueNumber: number, commentId: number, body: string): Promise<void> {
        return this.vcs.updateIssueComment(issueNumber, commentId, body)
    }

    /** Post a bot comment on a PR/MR (GitLab routes MR notes to a distinct
     *  endpoint, so PR comments don't reuse the issue-comment methods). */
    postPrComment(prNumber: number, body: string): Promise<{ id: number }> {
        return this.vcs.createPullRequestComment(prNumber, body)
    }

    /** Edit a bot comment on a PR/MR in place. */
    updatePrComment(prNumber: number, commentId: number, body: string): Promise<void> {
        return this.vcs.updatePullRequestComment(prNumber, commentId, body)
    }

    // ─── PR reads (used by the PR-analysis flow for the diff) ─────────────────
    /** A PR's changed files (with per-file unified patches). */
    listPullRequestFiles(number: number): Promise<VcsPullRequestFile[]> {
        return this.vcs.listPullRequestFiles(number)
    }

    // ─── PR merge (used by the merge route) ──────────────────────────────────
    /** Which merge strategies the repo permits. */
    getMergeMethods(): Promise<VcsMergeMethods> {
        return this.vcs.getMergeMethods()
    }
    /** The provider's live mergeability signal for one PR. */
    getMergeability(number: number): Promise<VcsMergeability> {
        return this.vcs.getMergeability(number)
    }
    /** Perform the merge (throws VcsMergeError on a provider refusal). */
    mergePullRequest(number: number, input: VcsMergeInput): Promise<VcsMergeResult> {
        return this.vcs.mergePullRequest(number, input)
    }
}
