// The detached PR-review lifecycle: fetch the diff, post an "analysing…" comment,
// kick a detached analyser run, then edit the comment on the callback; cancel on
// close. Every collaborator is injected by the composition root; the
// pull_request_analyses table is reached through PullRequestAnalysisStore.

import { tryOrNull } from "@/lib/shared/kernel"
import { Project, type ProjectsRepository } from "@/modules/projects"
import type { VcsAppService, VcsProviderBinding } from "@/modules/vcs"
import type { PrAnalysis } from "@/lib/shared/types"
import { ProjectAnalyser } from "../domain/ProjectAnalyser"
import type { AnalyserResolver } from "../ports/Analyser"
import type { PrAnalyseFile } from "../ports/AnalyserTypes"
import type { ProjectAnalyserRepository } from "../ports/ProjectAnalyserRepository"
import type { PullRequestAnalysisStore } from "../ports/PullRequestAnalysisStore"
import { PullRequestAnalysisComment } from "./PullRequestAnalysisComment"

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
    ) {}

    /** Gate on link + indexed graph, post/re-use the loading comment, upsert the
     *  tracking row (its id is the analyser task_id), kick the run. Idempotent —
     *  a run already in flight for this PR is left alone. */
    async start(project: PrProject, pr: PrInput, origin: string): Promise<void> {
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

        const existing = await this.store.findTracking(project.id, pr.number)
        if (existing?.status === "analysing") return

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
            },
            row.id,
            { url: `${origin}/api/internal/pr-analysis-result`, token: process.env.BOBBY_ANALYSER_TOKEN },
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
