// The detached PR-review lifecycle: fetch the diff, post an "analysing…" comment,
// kick a detached analyser run, then edit the comment on the callback; cancel on
// close. Every collaborator is injected by the composition root; the
// pull_request_analyses table is reached through PullRequestAnalysisStore.

import { RepositoryError, tryOrNull } from "@/lib/shared/kernel"
import { Project, type ProjectsRepository } from "@/modules/projects"
import type { VcsAppService, VcsProviderBinding } from "@/modules/vcs"
import type { PrAnalysis } from "@/lib/shared/types"
import type { SpendGate, SubscriptionsRepository } from "@/modules/billing"
import { ProjectAnalyser } from "../domain/ProjectAnalyser"
import type { AnalyserResolver } from "../ports/Analyser"
import type { PrAnalyseFile } from "../ports/AnalyserTypes"
import type { ProjectAnalyserRepository } from "../ports/ProjectAnalyserRepository"
import type { PullRequestAnalysisResultRow, PullRequestAnalysisStore } from "../ports/PullRequestAnalysisStore"
import type { ReviewProfileRepository } from "../ports/ReviewProfileRepository"
import { compilePolicy, maxDepthForTier, type ReviewProfile } from "../domain/ReviewProfile"
import { diffRounds } from "../domain/ReviewRounds"
import { findingState } from "@/lib/shared/rendering/finding-state"
import { PullRequestAnalysisComment } from "./PullRequestAnalysisComment"
import { callbackOrigin } from "../domain/CallbackOrigin"

/** The mirrored pull request, as the continuation reads it. Declared here rather
 *  than importing the vcs read repository: this service needs four fields to
 *  restart a review, and taking a dependency on that module's port to get them
 *  would couple analysis to the shape of the mirror. */
export interface PrMirror {
    findByNumber(projectId: string, prNumber: number): Promise<{
        title: string
        body: string | null
        state: "open" | "closed"
        merged: boolean
        head_sha: string | null
        base_sha: string | null
    } | null>
}

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
        /** The team's plan, read only to cap how DEEP a review may go. Optional
         *  for the same reason as `profiles`; absent means the profile's depth is
         *  taken at face value. */
        private readonly subscriptions?: SubscriptionsRepository,
        /** The PR mirror, for restarting a review when the head moved mid-run
         *  (0080). Optional so every existing caller constructs unchanged; without
         *  it a coalesced push is simply not chased, which is the behaviour
         *  before rounds existed. */
        private readonly pulls?: PrMirror,
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
        if (existing?.status === "analysing") {
            // A push landed while a review was running. This used to `return`
            // outright, keeping no record — so the review finished describing an
            // older head, the comment described code no longer in the pull
            // request, and the merge gate judged that stale review, with nothing
            // left to trigger a re-run. Record the head instead; the callback
            // starts the next round for it.
            //
            // This also makes the running review its own debounce window. Ten
            // pushes during one review collapse to one pending head, so the PR
            // gets two reviews rather than ten, and the second covers the state
            // that actually matters. No timer is involved, which is just as well
            // — this stack has no scheduler to hang one on.
            if (pr.headSha && pr.headSha !== existing.headSha) {
                await tryOrNull(() => this.store.setPendingHead(project.id, pr.number, pr.headSha as string))
            }
            return
        }

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

        // The team's reviewer configuration. Best-effort on purpose: a profile
        // that can't be read must not stop the review, because the failure mode
        // of "we couldn't load your settings" should be the DEFAULT reviewer, not
        // silence on a pull request. Resolved late — after every gate has passed
        // and the loading comment is up — so an unreadable profile costs nothing.
        const profile = this.profiles ? await this.loadProfile(project.id) : null

        // Depth is the one dial that costs money, so it is the only one the plan
        // gets a say in — and it CLAMPS rather than refuses: a team that
        // downgrades should get shallower reviews, not none.
        //
        // An unreadable subscription leaves the depth alone rather than dropping
        // it to the floor. Fail-closed is the right instinct for "may this team
        // spend at all", and the spend gate above already applies it — by the
        // time we are here billing has been read successfully once, so a failure
        // now is a blip. Punishing a paying team for it, on a run whose USD
        // ceiling is already fixed upstream, would be the worse trade.
        const tier = profile && this.subscriptions
            ? (await tryOrNull(() => this.subscriptions!.findByTeam(payer)))?.tier
            : undefined

        // Compiled ONCE, then both sent and recorded. That is the point of doing
        // it here rather than inline at the dispatch below: the attribution
        // stored on the row is the very object that crossed the wire, not a
        // second reconstruction of it that could disagree. Resolution moved above
        // the upsert for the same reason — a row that exists before we know what
        // is reviewing it has a window where it can only answer "unknown".
        const policy = compilePolicy(profile, tier ? { maxDepth: maxDepthForTier(tier) } : {})

        const row = await this.store.upsertTracking({
            projectId: project.id,
            prNumber: pr.number,
            githubCommentId: commentId,
            headSha: pr.headSha,
            status: "analysing",
            reviewProfileId: profile?.id ?? null,
            // The default is recorded EXPLICITLY rather than left as an absence.
            // "Nothing is configured, so the built-in reviewer ran" is an answer;
            // a blank row is not, and the two are indistinguishable once stored
            // the same way. Only pre-0079 rows are allowed to be blank.
            reviewProfile:
                profile && policy
                    ? { kind: "profile", id: profile.id, name: profile.name, preset: profile.preset, policy }
                    : { kind: "default" },
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
                // null (no profile, or unreadable) sends NOTHING, which every
                // analyser build understands as the default reviewer — including
                // the ones deployed before policies existed.
                policy: policy ?? undefined,
                // What the last round flagged, so this one can check rather than
                // rediscover. Best-effort: a re-review without it is simply the
                // review we would have run before rounds existed.
                previous_blockers: await this.previousBlockers(project.id, pr.number),
            },
            row.id,
            { url: `${callbackOrigin(origin)}/api/internal/pr-analysis-result`, token: process.env.BOBBY_ANALYSER_TOKEN },
        )
    }

    /** The team's profile for this project, or null if it cannot be read.
     *
     *  Fail-open, for the reason given at the call site — but NOT silent, which
     *  is why this exists instead of `tryOrNull`. That helper swallows every
     *  RepositoryError without a trace, and the failure it hides here is
     *  invisible downstream: the review runs as the DEFAULT reviewer and comes
     *  out looking exactly like a profile whose lenses found nothing. An
     *  unapplied migration, a renamed column, a permissions change and a
     *  correctly-unassigned project all produce the same clean output, and only
     *  one of them is intentional.
     *
     *  Non-repository errors still propagate, matching tryOrNull: a TypeError in
     *  here is a bug in our code, and swallowing it would be the very thing this
     *  method exists to stop. */
    private async loadProfile(projectId: string): Promise<ReviewProfile | null> {
        try {
            return await this.profiles!.findForProject(projectId)
        } catch (e) {
            if (!(e instanceof RepositoryError)) throw e
            console.warn(
                `[pr-review] could not read the review profile for project ${projectId} — ` +
                    `this review will run as the DEFAULT reviewer and will look like an unconfigured one. ` +
                    `Cause: ${e.message}`,
            )
            return null
        }
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

        // The rounds BEFORE this one, so the comment can say what changed. Read
        // before the new round is appended, which is what makes "previous" mean
        // previous. Best-effort: a comment without history is the old comment,
        // and that is a better outcome than no comment.
        const history = status === "done" && result
            ? await this.commentHistory(row.projectId, row.prNumber, result)
            : undefined

        if (row.githubCommentId != null) {
            const project = await this.projects.findGithubSyncContext(row.projectId)
            if (project && Project.of(project).isSyncReady()) {
                const vcs = this.vcsFor(project)
                if (vcs) {
                    const uiUrl = `${origin}/projects/${row.projectId}/pulls/${row.prNumber}`
                    const body =
                        status === "done" && result
                            ? this.comment.result(result, origin, uiUrl, row.prNumber, row.reviewProfile, history)
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

        // The round: this review, at this head, kept so the NEXT one can say what
        // changed instead of replacing the answer. Best-effort — history is worth
        // less than the review it describes, and a failure to record it must not
        // fail the callback that just delivered one.
        if (status === "done" && row.headSha) {
            await tryOrNull(() =>
                this.store.appendRound({
                    projectId: row.projectId,
                    prNumber: row.prNumber,
                    headSha: row.headSha as string,
                    status,
                    result,
                    reviewProfile: row.reviewProfile,
                }),
            )
        }

        await this.continueIfMoved(row, origin)
    }

    /** The last round's blockers, shaped for the analyser. Capped: a review that
     *  found twenty blockers does not need all twenty re-checked by name, and the
     *  list competes for the same context the diff needs. */
    private async previousBlockers(projectId: string, prNumber: number) {
        const rounds = await tryOrNull(() => this.store.listRounds(projectId, prNumber, 1))
        const last = rounds?.[0]
        if (!last || last.degraded) return undefined // a partial round is not a baseline
        const blockers = last.findings
            .filter((f) => findingState(f.severity) === "critical")
            .slice(0, 12)
            .map((f) => ({ file: f.file, line: f.line, title: (f.title ?? f.detail ?? "").slice(0, 160) }))
        return blockers.length > 0 ? blockers : undefined
    }

    /** What the comment needs to know about earlier rounds.
     *
     *  The delta itself is computed by the pure domain (diffRounds) from the two
     *  finding lists — never asked of the model, and never derived twice. This
     *  method only fetches and shapes. */
    private async commentHistory(projectId: string, prNumber: number, result: PrAnalysis) {
        const rounds = await tryOrNull(() => this.store.listRounds(projectId, prNumber, 6))
        if (!rounds || rounds.length === 0) return undefined

        const [previous, ...earlier] = rounds // newest first
        const delta = diffRounds(
            { headSha: "", findings: result.findings ?? [], degraded: result.degraded === true },
            { headSha: previous.headSha, findings: previous.findings },
            earlier.map((r) => ({ headSha: r.headSha, findings: r.findings })),
        )
        const remaining = (result.findings ?? []).filter((f) => findingState(f.severity) === "critical").length

        return {
            round: rounds.length + 1,
            fixed: delta.counts.fixed,
            remaining,
            withheld: delta.withheld,
            previous: rounds.map((r) => ({
                headSha: r.headSha,
                verdict: r.verdict,
                blockers: r.findings.filter((f) => findingState(f.severity) === "critical").length,
                fixed: 0,
            })),
        }
    }

    /** Start the next round when the pull request moved while this one ran.
     *
     *  Self-clocking: the finishing review is what triggers the next, so pushes
     *  during a review coalesce to the latest head with no timer anywhere. The
     *  pending head is cleared FIRST — a continuation that fails should leave the
     *  PR needing another push, not spinning on a head it cannot review. */
    private async continueIfMoved(row: PullRequestAnalysisResultRow, origin: string): Promise<void> {
        const pending = row.pendingHeadSha
        if (!pending || pending === row.headSha) return

        await tryOrNull(() => this.store.clearPendingHead(row.projectId, row.prNumber))

        if (!this.pulls) return

        const project = await tryOrNull(() => this.projects.findGithubSyncContext(row.projectId))
        if (!project) return

        const pr = await tryOrNull(() => this.pulls!.findByNumber(row.projectId, row.prNumber))
        // Only chase a pull request that is still open. A PR merged or closed
        // during the review has nothing left to say, and re-reviewing it would
        // post a comment onto a finished conversation.
        if (!pr || pr.state !== "open" || pr.merged) return

        await this.start(
            project as PrProject,
            {
                number: row.prNumber,
                title: pr.title,
                body: pr.body,
                baseSha: pr.base_sha,
                headSha: pr.head_sha,
            },
            origin,
        )
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
