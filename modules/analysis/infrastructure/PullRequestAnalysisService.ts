// The detached PR-review lifecycle: fetch the diff, post an "analysing…" comment,
// kick a detached analyser run, then edit the comment on the callback; cancel on
// close. Every collaborator is injected by the composition root; the
// pull_request_analyses table is reached through PullRequestAnalysisStore.

import { tryOrNull } from "@/lib/shared/kernel"
import { Project, type ProjectsRepository } from "@/modules/projects"
import type { VcsAppService, VcsProviderBinding } from "@/modules/vcs"
import type { PrAnalysis } from "@/lib/shared/types"
import type { SpendGate } from "@/modules/billing"
import { ProjectAnalyser } from "../domain/ProjectAnalyser"
import type { AnalyserResolver } from "../ports/Analyser"
import type { PrAnalyseFile } from "../ports/AnalyserTypes"
import type { ProjectAnalyserRepository } from "../ports/ProjectAnalyserRepository"
import type { PullRequestAnalysisStore } from "../ports/PullRequestAnalysisStore"
import type { ReviewProfileRepository } from "../ports/ReviewProfileRepository"
import { compilePolicy } from "../domain/ReviewProfile"
import { PullRequestAnalysisComment } from "./PullRequestAnalysisComment"
import { callbackOrigin } from "../domain/CallbackOrigin"

/** The project fields PR analysis reads: id + the sync-readiness/provider wiring. */
export type PrProject = {
    id: string
    repo_url: string | null
    repo_full_name: string | null
    github_installation_id: number | null
    github_repo_id: number | null
    github_sync_enabled: boolean
    // Provider wiring so a GitLab MR resolves to the GitLab adapter (isSyncReady +
    // vcsFor both branch on these). Omitted → treated as GitHub.
    provider?: "github" | "gitlab" | null
    gitlab_project_id?: number | null
}

/** The PR metadata from the webhook payload. */
export type PrInput = {
    number: number
    title: string
    body: string | null
    baseSha: string | null
    headSha: string | null
}

type VcsAppServiceResolver = (project: VcsProviderBinding) => VcsAppService | null

export class PullRequestAnalysisService {
    constructor(
        private readonly analyserFor: AnalyserResolver,
        private readonly projects: ProjectsRepository,
        private readonly analysers: ProjectAnalyserRepository,
        private readonly store: PullRequestAnalysisStore,
        private readonly vcsFor: VcsAppServiceResolver,
        private readonly comment: PullRequestAnalysisComment,
        /** The billing hard gate — see IssueAnalysisService for why it is injected. */
        private readonly spend: SpendGate,
        /** The team's review profile, resolved per project (0077). Optional so the
         *  existing tests and any caller predating profiles construct unchanged;
         *  absent means every review runs under the built-in default. */
        private readonly profiles?: ReviewProfileRepository,
    ) {}

    /** Gate on link + indexed graph, post/re-use the loading comment, upsert the
     *  tracking row (its id is the analyser task_id), kick the run. Idempotent —
     *  a run already in flight for this PR is left alone, and a run that already
     *  FINISHED on this exact head is not repeated (see the head gate below).
     *  `force` is the manual "Run review" button's override. */
    async start(project: PrProject, pr: PrInput, origin: string, opts: { force?: boolean } = {}): Promise<void> {
        if (!Project.of(project).isSyncReady()) return
        const vcs = this.vcsFor(project)
        if (!vcs) return

        const analyser = await tryOrNull(() => this.analysers.findReadiness(project.id))
        if (!ProjectAnalyser.from(analyser).isReady()) return

        // Resolve the cell up here, alongside the other readiness gates, rather
        // than at the call below — bailing out later would leave an "analysing…"
        // comment on the PR that nothing ever comes back to edit.
        const cell = await this.projects.findCell(project.id)
        if (!cell) return

        // Hard gate (0076): a paused team runs no reviews. Checked here, with the
        // other readiness gates and BEFORE the "analysing…" comment is posted —
        // bailing after that would leave a comment on the PR that nothing ever
        // comes back to edit. This service is webhook-driven, so this is the only
        // thing standing between a paused team and a review on every push.
        const payer = await tryOrNull(() => this.projects.findTeamId(project.id))
        if (!payer || (await this.spend.check(payer))) return

        const existing = await this.store.findTracking(project.id, pr.number)
        if (existing?.status === "analysing") return

        // A finished review already covers this head. Every `pull_request` event
        // that isn't a code change — reopened, edited, labeled, review_requested —
        // arrives with the SAME head_sha, so without this gate merely reopening or
        // touching a PR days later re-runs (and re-bills) a review whose input is
        // byte-for-byte identical. This is the skip migration 0042 provisioned
        // head_sha for. A `synchronize` moves the head and still re-runs.
        if (!opts.force && existing?.status === "done" && pr.headSha && existing.headSha === pr.headSha) return

        let files: PrAnalyseFile[]
        try {
            const gh = await vcs.listPullRequestFiles(pr.number)
            files = gh.map((f) => ({
                path: f.filename,
                previous_path: f.previousFilename,
                status: f.status,
                patch: f.patch,
                additions: f.additions,
                deletions: f.deletions,
            }))
        } catch {
            return
        }
        if (files.length === 0) return

        // Loading comment: edit the prior one on a re-run, else post fresh.
        const loadingUrl = `${origin}/projects/${project.id}/pulls/${pr.number}`
        let commentId = existing?.githubCommentId ?? null
        if (commentId != null) {
            try {
                await vcs.updatePrComment(pr.number, commentId, this.comment.loading(origin, pr.title, loadingUrl))
            } catch {
                commentId = null
            }
        }
        if (commentId == null) {
            try {
                const created = await vcs.postPrComment(pr.number, this.comment.loading(origin, pr.title, loadingUrl))
                commentId = created.id
            } catch {
                return
            }
        }

        const row = await this.store.upsertTracking({
            projectId: project.id,
            prNumber: pr.number,
            githubCommentId: commentId,
            headSha: pr.headSha,
            status: "analysing",
        })
        if (!row) return

        // The team's reviewer configuration. Best-effort on purpose: a profile
        // that can't be read must not stop the review, because the failure mode
        // of "we couldn't load your settings" should be the DEFAULT reviewer, not
        // silence on a pull request. Resolved late — after every gate has passed
        // and the loading comment is up — so an unreadable profile costs nothing.
        const profile = this.profiles ? await tryOrNull(() => this.profiles!.findForProject(project.id)) : null

        await this.analyserFor(cell).startPRAnalysis(
            {
                repoId: analyser!.graph_id!, // isReady() guarantees a non-null graph_id
                number: pr.number,
                title: pr.title,
                body: pr.body || "",
                baseSha: pr.baseSha || undefined,
                headSha: pr.headSha || undefined,
                files,
                projectId: project.id,
                // null (no profile, or unreadable) sends NOTHING, which every
                // analyser build understands as the default reviewer — including
                // the ones deployed before policies existed.
                policy: compilePolicy(profile) ?? undefined,
            },
            row.id,
            { url: `${callbackOrigin(origin)}/api/internal/pr-analysis-result`, token: process.env.BOBBY_ANALYSER_TOKEN },
        )
    }

    /** Terminal-state callback (from /api/internal/pr-analysis-result): edit the PR
     *  comment in place and persist the status + review. */
    async applyResult(
        taskId: string,
        status: "done" | "failed" | "cancelled",
        result: PrAnalysis | null,
        origin: string,
    ): Promise<void> {
        const row = await this.store.findResultRow(taskId)
        if (!row) return

        if (row.githubCommentId != null) {
            const project = await this.projects.findGithubSyncContext(row.projectId)
            if (project && Project.of(project).isSyncReady()) {
                const vcs = this.vcsFor(project)
                if (vcs) {
                    const uiUrl = `${origin}/projects/${row.projectId}/pulls/${row.prNumber}`
                    const body =
                        status === "done" && result
                            ? this.comment.result(result, origin, uiUrl, row.prNumber)
                            : status === "cancelled"
                              ? this.comment.cancelled(origin, row.prNumber)
                              : this.comment.failed(origin, row.prNumber)
                    try {
                        await vcs.updatePrComment(row.prNumber, row.githubCommentId, body)
                    } catch {
                        // Comment may have been deleted on the remote — don't fail the callback.
                    }
                }
            }
        }

        await this.store.saveResult(taskId, status, result)
    }

    /** Cancel an in-flight run (PR closed); the analyser reports 'cancelled' back. */
    async cancel(projectId: string, prNumber: number): Promise<void> {
        const row = await this.store.findTracking(projectId, prNumber)
        if (!row || row.status !== "analysing") return
        // A cancel has to reach the analyser actually running the task; an unknown
        // cell is a silent no-op, matching this method's best-effort contract.
        const cell = await this.projects.findCell(projectId)
        if (!cell) return
        await this.analyserFor(cell).cancelPRAnalysis(row.id)
    }
}
