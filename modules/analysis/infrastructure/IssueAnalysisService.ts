// The issue auto-analysis lifecycle: post an "analysing…" comment, kick a
// detached analyser run, then edit the comment + cache the suggestion on the
// callback; cancel on close. Every collaborator is injected by the composition
// root, so this never touches a token, owner/repo, DB client, or renderer detail.

import { tryOrNull } from "@/lib/shared/kernel"
import { type IssuePrompt, type IssueSyncStore, type IssueSyncPatch } from "@/modules/issues"
import { Project, type ProjectsRepository } from "@/modules/projects"
import type { VcsAppService, VcsProviderBinding } from "@/modules/vcs"
import type { IssueAnalysisData, IssuePriority } from "@/lib/shared/types"
import { ProjectAnalyser } from "../domain/ProjectAnalyser"
import type { Analyser } from "../ports/Analyser"
import type { IssueAnalysis } from "../ports/AnalyserTypes"
import type { ProjectAnalyserRepository } from "../ports/ProjectAnalyserRepository"
import { IssueAnalysisComment, type CommentCtx } from "./IssueAnalysisComment"

/** Resolves the app/bot VcsAppService for a project, or null when it isn't linked
 *  to a VCS. Injected so the service stays provider-agnostic. */
type VcsAppServiceResolver = (project: VcsProviderBinding) => VcsAppService | null

export class IssueAnalysisService {
    constructor(
        private readonly analyser: Analyser,
        private readonly issues: IssueSyncStore,
        private readonly projects: ProjectsRepository,
        private readonly analysers: ProjectAnalyserRepository,
        private readonly vcsFor: VcsAppServiceResolver,
        private readonly comment: IssueAnalysisComment,
        private readonly prompt: IssuePrompt,
    ) {}

    // ensure kicks off the SINGLE analysis run for an issue and is the one entry
    // point for both surfaces: the tracker's suggestion box (via the
    // issue_suggestions row its callback writes → realtime) and the bot comment
    // (posted here, edited by the callback). Idempotent + one-shot:
    //   - a run already in flight (analysis_status='analysing') → "in_flight"
    //   - a result already cached (issue_suggestions row exists)  → "done"
    async ensure(
        issueId: string,
        origin: string,
    ): Promise<"started" | "in_flight" | "done" | "not_ready" | "no_issue"> {
        const issue = await this.issues.findAnalysisRow(issueId)
        if (!issue) return "no_issue"

        // Idempotent / one-shot: don't start a second run.
        if (issue.analysis_status === "analysing") return "in_flight"
        if ((await this.issues.countSuggestions(issueId)) > 0) return "done"

        // Fail-safe: a query error folds to null → treated as not-ready.
        const analyser = await tryOrNull(() => this.analysers.findByProjectId(issue.project_id))
        if (!ProjectAnalyser.from(analyser).isReady()) return "not_ready"

        const update: IssueSyncPatch = { analysis_status: "analysing" }

        // Post the "analysing…" placeholder only when the issue is linked + sync is
        // on. The vcs module owns owner/repo/token; we hand it the issue number and
        // a rendered body. For web-only projects the analysis still runs + caches.
        const project = await this.projects.findAnalysisContext(issue.project_id)
        if (project && Project.of(project).isSyncReady() && issue.github_issue_number != null) {
            const vcs = this.vcsFor(project)
            if (vcs) {
                try {
                    const { id: commentId } = await vcs.postComment(
                        issue.github_issue_number,
                        this.comment.loading({ origin, projectId: issue.project_id, issueId: issue.id }),
                    )
                    update.github_analysis_comment_id = commentId
                } catch {
                    // Comment is best-effort; the analysis still runs + caches.
                }
            }
        }

        await this.issues.updateSyncFields(issueId, update)

        // Kick the single detached run; its callback caches to issue_suggestions
        // (the web box picks it up via realtime) and edits the bot comment.
        await this.analyser.startIssueAnalysis(
            {
                // isReady() above guarantees a non-null analyser with a graph_id.
                repoId: analyser!.graph_id!,
                title: issue.title,
                body: issue.body || "",
                labels: issue.labels || [],
                priority: issue.priority || undefined,
            },
            issueId,
            { url: `${origin}/api/internal/analysis-result`, token: process.env.BOBBY_ANALYSER_TOKEN },
        )
        return "started"
    }

    // applyResult is invoked by /api/internal/analysis-result when the analyser
    // reports a terminal state. It edits the placeholder comment in place, records
    // analysis_status, and (on success) caches the suggestion so the tracker UI
    // mirrors it.
    async applyResult(
        taskId: string,
        status: "done" | "failed" | "cancelled",
        result: IssueAnalysis | null,
        origin: string,
    ): Promise<void> {
        const issue = await this.issues.findAnalysisRow(taskId)
        if (!issue) return

        const project = await this.projects.findAnalysisContext(issue.project_id)

        // Edit the placeholder in place (when we still have its id + a linked repo).
        if (
            project &&
            Project.of(project).isSyncReady() &&
            issue.github_analysis_comment_id != null &&
            issue.github_issue_number != null
        ) {
            const vcs = this.vcsFor(project)
            if (vcs) {
                const ctx: CommentCtx = { origin, projectId: issue.project_id, issueId: issue.id }
                const body =
                    status === "done" && result
                        ? this.comment.result(result, project, ctx)
                        : status === "cancelled"
                          ? this.comment.cancelled(ctx)
                          : this.comment.failed(ctx)
                try {
                    await vcs.updateComment(issue.github_issue_number, issue.github_analysis_comment_id, body)
                } catch {
                    // The comment may have been deleted on the remote — don't fail the callback.
                }
            }
        }

        await this.issues.updateSyncFields(taskId, { analysis_status: status })

        // Cache the successful analysis so the tracker UI mirrors the comment.
        if (status === "done" && result && project) {
            try {
                const graphId = await tryOrNull(() => this.analysers.findGraphId(issue.project_id))
                const dataWithPrompt: IssueAnalysisData = {
                    ...result,
                    fix_prompt: this.prompt.compose({
                        project,
                        issue: {
                            issue_number: issue.issue_number,
                            title: issue.title,
                            body: issue.body ?? "",
                            status: issue.status,
                            priority: (issue.priority ?? "medium") as IssuePriority,
                            labels: issue.labels ?? [],
                        },
                        suggestion: {
                            id: "",
                            issue_id: issue.id,
                            data: result,
                            markdown: result.markdown ?? result.summary ?? "",
                            code_cites: (result.suggestions ?? []).map((s) => ({ file: s.file, line: s.line })),
                            graph_cites: result.graph_cites ?? [],
                            confidence: result.confidence ?? null,
                            cost_usd: result.cost_usd ?? 0,
                            duration_ms: result.duration_ms ?? 0,
                            graph_id: graphId,
                            created_at: new Date().toISOString(),
                        },
                    }),
                }
                await this.issues.insertSuggestion({
                    issue_id: issue.id,
                    data: dataWithPrompt,
                    markdown: result.markdown ?? result.summary ?? "",
                    code_cites: (result.suggestions ?? []).map((s) => ({ file: s.file, line: s.line })),
                    graph_cites: result.graph_cites ?? [],
                    confidence: result.confidence ?? null,
                    cost_usd: result.cost_usd ?? 0,
                    duration_ms: result.duration_ms ?? 0,
                    graph_id: graphId,
                })
            } catch {
                // Cache is best-effort; the bot comment is the source of truth.
            }
        }
    }

    // cancel asks the analyser to stop an in-flight run (issue closed). The analyser
    // then reports status=cancelled via the callback, which edits the comment.
    // Best-effort — a cancel for an already-finished task is a no-op.
    async cancel(issueId: string): Promise<void> {
        await this.analyser.cancelIssueAnalysis(issueId)
    }
}
