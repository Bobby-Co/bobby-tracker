// PR-analysis orchestration — the detached PR-review lifecycle, as a service that
// OWNS the flow (was floating functions). On a pull_request event we fetch the
// diff, post an "analysing…" comment, kick a detached analyser run, and edit that
// comment in place on the callback. Closing the PR cancels the run.
//
// The GitHub side is "read the diff / post a comment" via the injected
// VcsAppService provider — no token, owner/repo, or REST client here. The
// pull_request_analyses table is reached through the PullRequestAnalysisStore port
// (previously hit inline — the golden-standard fix). A boundary orchestrator in
// infrastructure; the composition root injects every collaborator.

import { tryOrNull } from "@/lib/kernel"
import { Project, type ProjectsRepository } from "@/modules/projects"
import type { VcsAppService, VcsProviderBinding } from "@/modules/vcs"
import type { PRAnalysis } from "@/lib/supabase/types"
import { ProjectAnalyser } from "../domain/ProjectAnalyser"
import type { Analyser } from "../ports/Analyser"
import type { PRAnalyseFile } from "../ports/AnalyserTypes"
import type { ProjectAnalyserRepository } from "../ports/ProjectAnalyserRepository"
import type { PullRequestAnalysisStore } from "../ports/PullRequestAnalysisStore"
import { cancelledComment, failedComment, loadingComment, resultComment } from "./PullRequestAnalysisComment"

/** The project fields PR analysis reads: id + the sync-readiness/provider wiring. */
export type PRProject = {
    id: string
    repo_url: string | null
    repo_full_name: string | null
    github_installation_id: number | null
    github_repo_id: number | null
    github_sync_enabled: boolean
}

/** PRInput is the PR metadata from the webhook payload. */
export type PRInput = {
    number: number
    title: string
    body: string | null
    baseSha: string | null
    headSha: string | null
}

type VcsAppServiceResolver = (project: VcsProviderBinding) => VcsAppService | null

export class PullRequestAnalysisService {
    constructor(
        private readonly analyser: Analyser,
        private readonly projects: ProjectsRepository,
        private readonly analysers: ProjectAnalyserRepository,
        private readonly store: PullRequestAnalysisStore,
        private readonly vcsFor: VcsAppServiceResolver,
    ) {}

    // start gates on the App being linked + the graph indexed, fetches the PR diff,
    // posts (or re-uses) the "analysing…" comment, upserts the tracking row (its id
    // is the analyser task_id), and kicks the detached run. Idempotent: a run
    // already in flight for this PR is left alone.
    async start(project: PRProject, pr: PRInput, origin: string): Promise<void> {
        if (!Project.of(project).isSyncReady()) return
        const vcs = this.vcsFor(project)
        if (!vcs) return

        // Gate: the graph must be indexed for the review to have codebase context.
        const analyser = await tryOrNull(() => this.analysers.findReadiness(project.id))
        if (!ProjectAnalyser.from(analyser).isReady()) return

        // Idempotency: don't start a second run while one is in flight for this PR.
        const existing = await this.store.findTracking(project.id, pr.number)
        if (existing?.status === "analysing") return

        // Fetch the diff (per-file patches) through the vcs service.
        let files: PRAnalyseFile[]
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
                await vcs.updateComment(commentId, loadingComment(origin, pr.title, loadingUrl))
            } catch {
                commentId = null
            }
        }
        if (commentId == null) {
            try {
                const created = await vcs.postComment(pr.number, loadingComment(origin, pr.title, loadingUrl))
                commentId = created.id
            } catch {
                return
            }
        }

        // Upsert the tracking row — id doubles as the analyser task_id.
        const row = await this.store.upsertTracking({
            projectId: project.id,
            prNumber: pr.number,
            githubCommentId: commentId,
            headSha: pr.headSha,
            status: "analysing",
        })
        if (!row) return

        await this.analyser.startPRAnalysis(
            {
                // isReady() above guarantees a non-null analyser with a graph_id.
                repoId: analyser!.graph_id!,
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

    // applyResult is invoked by /api/internal/pr-analysis-result when the analyser
    // reports a terminal state. It edits the PR comment in place and records status.
    async applyResult(
        taskId: string,
        status: "done" | "failed" | "cancelled",
        result: PRAnalysis | null,
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
                            ? resultComment(result, origin, uiUrl, row.prNumber)
                            : status === "cancelled"
                              ? cancelledComment(origin, row.prNumber)
                              : failedComment(origin, row.prNumber)
                    try {
                        await vcs.updateComment(row.githubCommentId, body)
                    } catch {
                        // Comment may have been deleted on the remote — don't fail the callback.
                    }
                }
            }
        }

        await this.store.saveResult(taskId, status, result)
    }

    // cancel stops an in-flight run when a PR is closed. The analyser reports
    // 'cancelled' via the callback, which updates the comment.
    async cancel(projectId: string, prNumber: number): Promise<void> {
        const row = await this.store.findTracking(projectId, prNumber)
        if (!row || row.status !== "analysing") return
        await this.analyser.cancelPRAnalysis(row.id)
    }
}
