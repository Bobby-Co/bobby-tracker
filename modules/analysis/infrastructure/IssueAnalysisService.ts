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
import type { AnalyserResolver } from "../ports/Analyser"
import type { IssueAnalysis } from "../ports/AnalyserTypes"
import type { ProjectAnalyserRepository } from "../ports/ProjectAnalyserRepository"
import { IssueAnalysisComment, type CommentCtx } from "./IssueAnalysisComment"
import { callbackOrigin } from "../domain/CallbackOrigin"
import { analysisIsAbandoned } from "../domain/AnalysisRun"
import { trace } from "@/lib/server/trace"

/** What `ensure` decided. The string cases are progress states; a SpendRefusal is
 *  a billing stop, and it carries its own user-facing message so the route does
 *  not have to guess which of the two reasons applied. */
export type EnsureOutcome =
    | "started"
    /** Admitted, but the team is at its tier's concurrency cap, so the run has
     *  not been dispatched yet. Not a failure and NOT a refusal: the request was
     *  accepted, and the finishing of some other run is what will start it. */
    | "queued"
    | "in_flight"
    | "done"
    | "not_ready"
    | "no_issue"
    | SpendRefusal

/** A project whose owning team cannot be resolved. Shaped as a refusal because
 *  that is what it is — nothing may be billed to nobody — and it keeps the caller
 *  from needing a sixth case for a state it can do nothing about. */
const UNRESOLVED_PAYER: SpendRefusal = {
    reason: "suspended",
    message: "This project isn't linked to a team that can run analysis.",
}
import type { SpendGate, SpendRefusal } from "@/modules/billing"
import type { RunAdmission } from "../application/RunAdmission"

/** Resolves the app/bot VcsAppService for a project, or null when it isn't linked
 *  to a VCS. Injected so the service stays provider-agnostic. */
type VcsAppServiceResolver = (project: VcsProviderBinding) => VcsAppService | null

export class IssueAnalysisService {
    constructor(
        private readonly analyserFor: AnalyserResolver,
        private readonly issues: IssueSyncStore,
        private readonly projects: ProjectsRepository,
        private readonly analysers: ProjectAnalyserRepository,
        private readonly vcsFor: VcsAppServiceResolver,
        private readonly comment: IssueAnalysisComment,
        private readonly prompt: IssuePrompt,
        /** The billing hard gate. Injected rather than reached for, so a host that
         *  meters differently swaps it at the composition root. */
        private readonly spend: SpendGate,
        /** The per-team concurrency bound. Separate from `spend` because it stops
         *  a different failure — a burst that outruns the ledger rather than a
         *  budget that has run out. */
        private readonly admission: RunAdmission,
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
        opts: { fromQueue?: boolean } = {},
    ): Promise<EnsureOutcome> {
        const issue = await this.issues.findAnalysisRow(issueId)
        trace("ensure.lookup", {
            issueId,
            found: !!issue,
            status: issue?.analysis_status ?? null,
            startedAt: issue?.analysis_started_at ?? null,
        })
        if (!issue) return "no_issue"

        // Idempotent / one-shot: don't start a second run.
        //
        // ...unless the one we're deferring to was abandoned. This branch used to
        // be unconditional, which meant a single lost callback wedged the issue
        // permanently: the status is written before dispatch and only the
        // callback clears it, so nothing could ever set it back. Every retry
        // returned in_flight and never reached an analyser again.
        if (issue.analysis_status === "analysing" && !analysisIsAbandoned(issue.analysis_started_at)) {
            trace("ensure.inFlight", { issueId, startedAt: issue.analysis_started_at })
            return "in_flight"
        }
        // Already waiting for a slot. Asking again does not move it up the queue,
        // and must not enqueue it twice — the same one-shot rule as above, for the
        // state before dispatch rather than after it.
        //
        // The DRAIN is the one caller allowed past this, because it is calling
        // about a run it has already decided to start: for it, 'queued' is the
        // reason it is here rather than a reason to stop.
        if (issue.analysis_status === "queued" && !opts.fromQueue) {
            trace("ensure.queued", { issueId, already: true })
            return "queued"
        }
        const cached = await this.issues.countSuggestions(issueId)
        trace("ensure.suggestions", { issueId, cached })
        if (cached > 0) return "done"

        // Fail-safe: a query error folds to null → treated as not-ready.
        const analyser = await tryOrNull(() => this.analysers.findByProjectId(issue.project_id))
        if (!ProjectAnalyser.from(analyser).isReady()) return "not_ready"

        // Route to the CELL holding this project's graph (0062) — not its region,
        // which may contain several cells and only one has the graph. A project
        // whose cell we can't read is not analysable: defaulting would hand the run
        // to an analyser that has never seen this repo, producing a confidently
        // empty result rather than an honest failure.
        const cell = await this.projects.findCell(issue.project_id)
        trace("ensure.cell", { issueId, projectId: issue.project_id, cell })
        if (!cell) return "not_ready"

        // Hard gate (0076): a paused team — or one that has spent its monthly
        // allowance — analyses nothing. Enforced HERE, not only at the routes,
        // because this service is also reached from the GitHub and GitLab webhooks
        // — the paths with no session behind them, which would otherwise keep
        // analysing every inbound issue indefinitely. An unresolvable team is
        // refused too: fail closed, since the alternative is billing work to
        // nobody.
        //
        // The refusal is RETURNED rather than flattened to a token, because the
        // two reasons need different words and only the gate knows the numbers
        // (what the allowance was, when it resets) that make the message useful.
        const payer = await tryOrNull(() => this.projects.findTeamId(issue.project_id))
        if (!payer) {
            trace("ensure.refused", { issueId, projectId: issue.project_id, payer: null })
            return UNRESOLVED_PAYER
        }
        const refusal = await this.spend.check(payer)
        if (refusal) {
            trace("ensure.refused", { issueId, projectId: issue.project_id, payer, reason: refusal.reason })
            return refusal
        }

        // Burst bound. Checked AFTER the budget (a team with no credits should
        // hear about the credits, not the queue) and BEFORE the row is marked
        // 'analysing' — marking first would count this run against its own cap.
        //
        // The window between counting and marking is not zero, so two dispatches
        // that arrive together can both pass at the boundary. That is acceptable
        // for a safety bound: it can overshoot the cap by the number of truly
        // simultaneous requests, not by the size of a scripted burst, because
        // every one of those is serialised behind this read.
        // At the cap the request is ACCEPTED and the work deferred, rather than
        // refused. Pressing "Investigate" on a third issue is not an error; it is
        // a wait, and reporting it as a failure taught users that the product was
        // broken when it was busy.
        //
        // Nothing about the spend bound weakens. The run is not dispatched, costs
        // nothing while it waits, and passes this same gate again when the drain
        // picks it up — so a queue built against the last of a team's credits
        // stops draining the moment the balance goes, which refusing never gave us.
        //
        // analysis_started_at is deliberately left NULL: it means "when this run
        // started", the staleness rule for 'analysing' is built on it, and a
        // queued run has not started. Order in the queue comes from updated_at.
        const crowded = await this.admission.check(payer)
        if (crowded) {
            trace("ensure.queueing", { issueId, projectId: issue.project_id, payer })
            await this.issues.updateSyncFields(issueId, {
                analysis_status: "queued",
                analysis_started_at: null,
            })
            return "queued"
        }

        // Stamped with the status, and the reason they must be written together:
        // the status alone cannot distinguish a run in progress from one that
        // died, and that ambiguity is what made a lost callback permanent.
        const update: IssueSyncPatch = {
            analysis_status: "analysing",
            analysis_started_at: new Date().toISOString(),
        }

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
        trace("ensure.marked", { issueId, startedAt: update.analysis_started_at })

        // Kick the single detached run; its callback caches to issue_suggestions
        // (the web box picks it up via realtime) and edits the bot comment.
        await this.analyserFor(cell).startIssueAnalysis(
            {
                // isReady() above guarantees a non-null analyser with a graph_id.
                repoId: analyser!.graph_id!,
                title: issue.title,
                body: issue.body || "",
                labels: issue.labels || [],
                priority: issue.priority || undefined,
            },
            issueId,
            // Deliberately the UNSUFFIXED token, not the cell's. This is the
            // tracker's inbound secret — what /api/internal/analysis-result checks
            // when the analyser calls back — so it is shared by every cell, unlike
            // the per-cell bearer we authenticate outbound with.
            { url: `${callbackOrigin(origin)}/api/internal/analysis-result`, token: process.env.BOBBY_ANALYSER_TOKEN },
        )
        trace("ensure.dispatched", { issueId, cell, callback: `${callbackOrigin(origin)}/api/internal/analysis-result` })
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
        trace("apply.lookup", { taskId, status, found: !!issue, projectId: issue?.project_id ?? null })
        if (!issue) {
            // The result arrived and there is nowhere to put it. Almost always a
            // region mismatch: the run was dispatched against one database and
            // the callback is being handled against another.
            trace("apply.dropped", { taskId, why: "issue not in the database this callback is bound to" })
            return
        }

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
        trace("apply.status", { taskId, status })

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
                    // From the issue we already read out of its own region. The
                    // trigger that used to derive this cannot reach across the
                    // plane split.
                    user_id: issue.user_id,
                    data: dataWithPrompt,
                    markdown: result.markdown ?? result.summary ?? "",
                    code_cites: (result.suggestions ?? []).map((s) => ({ file: s.file, line: s.line })),
                    graph_cites: result.graph_cites ?? [],
                    confidence: result.confidence ?? null,
                    cost_usd: result.cost_usd ?? 0,
                    duration_ms: result.duration_ms ?? 0,
                    graph_id: graphId,
                })
                trace("apply.suggestionSaved", { taskId, issueId: issue.id })
            } catch (e) {
                // Still best-effort — the bot comment is the source of truth — but
                // no longer silent. This catch was swallowing the one write that
                // IS the analysis result, so a lost suggestion left no trace
                // anywhere: the run succeeded, was billed, and the UI stayed empty.
                trace("apply.suggestionFailed", {
                    taskId,
                    issueId: issue.id,
                    error: e instanceof Error ? e.message : String(e),
                })
            }
        }
    }

    // cancel asks the analyser to stop an in-flight run (issue closed). The analyser
    // then reports status=cancelled via the callback, which edits the comment.
    // Best-effort — a cancel for an already-finished task is a no-op.
    async cancel(issueId: string): Promise<void> {
        // Two extra reads to find the cell: a cancel must reach the analyser that
        // actually holds the run, and no other. Both fold to a silent no-op, which
        // matches this method's best-effort contract.
        const issue = await this.issues.findAnalysisRow(issueId)
        if (!issue) return
        const cell = await this.projects.findCell(issue.project_id)
        if (!cell) return
        await this.analyserFor(cell).cancelIssueAnalysis(issueId)
    }
}
