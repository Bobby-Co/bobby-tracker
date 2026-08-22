// The detached PR-review lifecycle: fetch the diff, post an "analysing…" comment,
// kick a detached analyser run, then edit the comment on the callback; cancel on
// close. Every collaborator is injected by the composition root; the
// pull_request_analyses table is reached through PullRequestAnalysisStore.

import { RepositoryError, tryOrNull } from "@/lib/shared/kernel"
import { Project, type ProjectsRepository } from "@/modules/projects"
import type { VcsAppService, VcsProviderBinding } from "@/modules/vcs"
import type { PrAnalysis, PrFinding, ReviewRoundCommit, ReviewRunScope } from "@/lib/shared/types"
import type { SpendGate, SubscriptionsRepository } from "@/modules/billing"
import { ProjectAnalyser } from "../domain/ProjectAnalyser"
import type { AnalyserResolver } from "../ports/Analyser"
import type { PrAnalyseFile } from "../ports/AnalyserTypes"
import type { ProjectAnalyserRepository } from "../ports/ProjectAnalyserRepository"
import type { PullRequestAnalysisResultRow, PullRequestAnalysisStore } from "../ports/PullRequestAnalysisStore"
import type { ReviewProfileRepository } from "../ports/ReviewProfileRepository"
import { compilePolicy, maxDepthForTier, type ReviewProfile } from "../domain/ReviewProfile"
import { diffRounds } from "../domain/ReviewRounds"
import { changedExportedSymbols } from "../domain/DiffFacts"
import { importedPullRequestFiles } from "../domain/ImportGraph"
import { carriedFraction, changedPathSet, mergeRound, partitionForCarry, type CarryPartition } from "../domain/CarryForward"
import { decideScope, roundsSinceFull, type Ancestry } from "../domain/ReviewScope"
import type { ReviewRound } from "../ports/PullRequestAnalysisStore"
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

/** How many rounds of history every read of this table asks for.
 *
 *  One number, used by the scope decision, the carry partition, the comment and
 *  the round selector alike. They all answer questions about the same story, and
 *  three different windows onto it is how one surface comes to say "round 3 of
 *  5" while another shows four rounds. */
const ROUND_WINDOW = 8

/** How many changed symbols the dependent-count rule probes.
 *
 *  The rule wants a MAXIMUM, and a push that changes more exported symbols than
 *  this is already large enough that the other rules will have caught it. Each
 *  probe is a graph hop with no model in it, but it is still a network call at
 *  dispatch, and the review is what the developer is waiting on. */
const DEPENDENT_PROBES = 5

/** The provider's file shape onto the analyser's. */
function toAnalyseFile(f: {
    filename: string
    previousFilename?: string
    status: string
    patch?: string
    additions: number
    deletions: number
}): PrAnalyseFile {
    return {
        path: f.filename,
        previous_path: f.previousFilename,
        status: f.status,
        patch: f.patch,
        additions: f.additions,
        deletions: f.deletions,
    }
}

/** A commit's first line. Providers hand back the whole message, and a round
 *  strip that rendered a paragraph per commit would be unreadable. */
function subjectOf(message: string): string {
    return (message ?? "").split("\n")[0].trim().slice(0, 200)
}

/** Only findings that GATE a merge. The same normaliser the gate and the panel
 *  use, so none of the three can disagree about what a blocker is. */
function isBlocker(f: PrFinding): boolean {
    return findingState(f.severity) === "critical"
}

/** Which profile judged a round, from its stored attribution. `null` means the
 *  built-in default ran — which is a real answer and compares equal to another
 *  default-reviewer round, so switching a project onto a profile registers as a
 *  change and switching it back off does too. */
function profileIdOf(round: ReviewRound): string | null {
    const p = round.reviewProfile
    return p?.kind === "profile" ? (p.id ?? null) : null
}

/** The blockers handed to the reviewer as a checklist.
 *
 *  Capped: a review that found twenty blockers does not need all twenty
 *  re-checked by name, and the list competes for the same context the diff
 *  needs. Withheld entirely when the last round was degraded — a partial review
 *  is not a baseline, and asking "is this still present?" about a list that was
 *  never complete would manufacture the appearance of progress. */
function previousBlockers(candidates: PrFinding[], previous: ReviewRound | null) {
    if (!previous || previous.degraded) return undefined
    const blockers = candidates
        .filter(isBlocker)
        .slice(0, 12)
        .map((f) => ({ file: f.file, line: f.line, title: (f.title ?? f.detail ?? "").slice(0, 160) }))
    return blockers.length > 0 ? blockers : undefined
}

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

        // ─── what to review ─────────────────────────────────────────────────
        //
        // Everything from here to the dispatch answers one question: does this
        // round review the whole pull request, or only what the push changed?
        // The rounds are read first because every input to that decision comes
        // from them — the last reviewed head, whether it completed, which
        // profile judged it, and how much of it was already riding along.
        const rounds = (await tryOrNull(() => this.store.listRounds(project.id, pr.number, ROUND_WINDOW))) ?? []
        const previous = rounds[0] ?? null

        // The team's reviewer configuration. Best-effort on purpose: a profile
        // that can't be read must not stop the review, because the failure mode
        // of "we couldn't load your settings" should be the DEFAULT reviewer, not
        // silence on a pull request.
        //
        // Resolved HERE rather than after the loading comment, where it used to
        // sit, because the scope decision reads it: a profile change since the
        // last round means round n was judged by a different reviewer than round
        // n−1, and nothing may be carried across that.
        const profile = this.profiles ? await this.loadProfile(project.id) : null

        // The compare. On a first round this is base…head (the whole PR's
        // commits, for the timeline); afterwards it is lastHead…head — the push
        // itself. Best-effort: a provider that cannot compare leaves the round
        // full, which is where every round was before this existed.
        const range = await this.compareRange(vcs, previous?.headSha ?? pr.baseSha, pr.headSha)

        const pushFiles: PrAnalyseFile[] = range ? range.files.map(toAnalyseFile) : []
        const changedSymbols = changedExportedSymbols(pushFiles)

        const decision = decideScope({
            previous: previous
                ? {
                      headSha: previous.headSha,
                      degraded: previous.degraded,
                      baseSha: previous.baseSha,
                      profileId: profileIdOf(previous),
                      round: previous.round,
                  }
                : null,
            headSha: pr.headSha,
            baseSha: pr.baseSha,
            // A truncated compare is not a picture of the push, so it cannot be
            // the basis of a scope decision — the provider capped the file list
            // and the files it dropped are exactly the ones nothing would review.
            ancestry: range && !range.truncated ? range.status : "unknown",
            pushFiles,
            profileId: profile?.id ?? null,
            roundsSinceFull: roundsSinceFull(rounds),
            carriedFraction: carriedFraction(previous?.findings ?? []),
            carriedCount: (previous?.findings ?? []).filter((f) => f.provenance?.carried === true).length,
            // Only worth asking when incremental is on the table at all. A first
            // round goes full whatever the graph says, and five graph hops at
            // dispatch are five hops the developer waits through.
            dependents: previous ? await this.maxDependents(analyser!.graph_id!, cell, changedSymbols) : null,
        })

        // The diff the reviewer actually receives. `full` re-reads the pull
        // request from the provider rather than reusing the compare:
        // listPullRequestFiles is base…head as GitHub computes it for the PR, and
        // it is the input every full review has ever had.
        let files: PrAnalyseFile[]
        let manifest: { path: string; status?: string }[] = []
        if (decision.scope === "incremental") {
            ;({ files, manifest } = await this.cumulativePatches(vcs, pr.number, pushFiles))
        } else {
            try {
                files = (await vcs.listPullRequestFiles(pr.number)).map(toAnalyseFile)
            } catch {
                return
            }
        }
        if (files.length === 0) return

        // Partition the previous findings. A finding rides along when its file is
        // absent from this diff AND none of the changed exported symbols appears
        // in its text; everything else goes back to the reviewer to re-judge,
        // which is the mechanism `previous_blockers` already is.
        const partition: CarryPartition =
            decision.scope === "incremental" && previous
                ? partitionForCarry({
                      previous: previous.findings,
                      changedFiles: [...changedPathSet(files)],
                      changedSymbols,
                  })
                : { carried: [], reJudge: previous?.findings ?? [], reasons: [] }

        const scope: ReviewRunScope = {
            scope: decision.scope,
            code: decision.code,
            reason: decision.reason,
            prevHeadSha: previous?.headSha ?? null,
            baseSha: pr.baseSha,
            commits: range?.commits ?? [],
            reviewedFiles: files.length,
            carried: partition.carried,
            reJudgedBlockers: partition.reJudge.filter(isBlocker),
        }

        console.info(
            `[pr-review] project=${project.id} pr=${pr.number} scope=${decision.scope} (${decision.code}) — ` +
                `${decision.reason}; ${files.length} file(s) reviewed, ${partition.carried.length} carried, ` +
                `${partition.reJudge.length} to re-judge`,
        )

        // Loading comment: edit the prior one on a re-run, else post fresh.
        //
        // It carries what we already know — which commits this round covers, how
        // it is scoped, and what the LAST round said. Editing a bare spinner over
        // a standing review was erasing the only answer anyone had at the exact
        // moment they most wanted it, and misrepresenting the gate, which was
        // still reading that review the whole time.
        const loadingUrl = `${origin}/projects/${project.id}/pulls/${pr.number}`
        const inflight = {
            commits: scope.commits,
            scope: scope.scope,
            carried: scope.carried.length,
            standing: previous
                ? { round: previous.round, verdict: previous.verdict, blockers: previous.findings.filter(isBlocker).length }
                : null,
        }
        let commentId = existing?.githubCommentId ?? null
        if (commentId != null) {
            try {
                await vcs.updatePrComment(pr.number, commentId, this.comment.loading(origin, pr.title, loadingUrl, inflight))
            } catch {
                commentId = null
            }
        }
        if (commentId == null) {
            try {
                const created = await vcs.postPrComment(pr.number, this.comment.loading(origin, pr.title, loadingUrl, inflight))
                commentId = created.id
            } catch {
                return
            }
        }

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
            // What this run is scoped to, and what it carries (0081). Written
            // here, with the run, because the CALLBACK has to honour it: it
            // merges the carried findings into the one list the merge gate
            // counts, and by the time it runs the head may have moved again.
            reviewScope: scope,
        })
        if (!row) return

        const callback = { url: `${callbackOrigin(origin)}/api/internal/pr-analysis-result`, token: process.env.BOBBY_ANALYSER_TOKEN }
        const dispatch = (input: PrAnalyseFile[], carrying: ReviewRunScope) =>
            this.analyserFor(cell).startPRAnalysis(
            {
                repoId: analyser!.graph_id!, // isReady() guarantees a non-null graph_id
                number: pr.number,
                title: pr.title,
                body: pr.body || "",
                baseSha: pr.baseSha || undefined,
                headSha: pr.headSha || undefined,
                files: input,
                projectId: project.id,
                // null (no profile, or unreadable) sends NOTHING, which every
                // analyser build understands as the default reviewer — including
                // the ones deployed before policies existed.
                policy: policy ?? undefined,
                // What the last round flagged, so this one can check rather than
                // rediscover. On an incremental round this is the RE-JUDGE half
                // of the partition — the blockers whose file or symbols this push
                // touched. On a full round it is everything the last round
                // blocked on, which is what it has always been.
                previous_blockers: previousBlockers(carrying.scope === "incremental" ? partition.reJudge : (previous?.findings ?? []), previous),
                // What this round is NOT reviewing, and must not re-report.
                //
                // Sending only the incremental diff means the reviewer cannot
                // see the carried findings' code unless it opens the files —
                // and on a nine-turn budget it should not. Naming them costs a
                // few lines and REMOVES work: without this the reviewer walks
                // the graph into an untouched file, finds the defect the last
                // round already found, and spends a turn reporting a duplicate
                // the merge would then count twice.
                carried_findings:
                    carrying.scope === "incremental" && carrying.carried.length > 0
                        ? carrying.carried.slice(0, 20).map((f) => ({
                              file: f.file,
                              line: f.line,
                              title: (f.title ?? f.detail ?? "").slice(0, 160),
                          }))
                        : undefined,
                // The range under review, so the reviewer knows the diff is a
                // PUSH and not the pull request. Omitted on a full round, where
                // the diff means exactly what it has always meant.
                review_scope:
                    carrying.scope === "incremental"
                        ? { kind: "incremental", previous_head_sha: carrying.prevHeadSha ?? undefined }
                        : undefined,
                // What the pull request CONTAINS, so the reviewer stops
                // concluding that files it was not shown do not exist. Omitted
                // on a full round, where the diff is already the manifest.
                pr_files: carrying.scope === "incremental" && manifest.length > 0 ? manifest : undefined,
            },
            row.id,
            callback,
        )

        try {
            await dispatch(files, scope)
        } catch (e) {
            // A cell that predates incremental review REJECTS this request
            // outright: the analyser decodes with DisallowUnknownFields, so
            // `carried_findings` and `review_scope` are a 400 rather than fields
            // it ignores. Without this the row stays "analysing" and the pull
            // request keeps a loading comment nothing ever comes back to edit —
            // for every PR, for the length of a partial deploy.
            //
            // So an incremental dispatch that fails is retried ONCE as the
            // review we would have run before any of this existed: the whole
            // pull request, no new fields, nothing carried. The fallback is
            // strictly MORE review, which is the only direction a fallback in
            // this pipeline is allowed to go.
            if (scope.scope !== "incremental") throw e
            console.warn(
                `[pr-review] project=${project.id} pr=${pr.number} — the incremental dispatch was refused ` +
                    `(${e instanceof Error ? e.message : String(e)}); falling back to a full review. ` +
                    `This is what an analyser cell deployed before incremental review looks like.`,
            )

            // Explicit catch, not tryOrNull — the same trap as cumulativePatches:
            // that helper rethrows anything that is not a RepositoryError, and a
            // provider failure is a plain Error. Rethrowing it here would report
            // the wrong cause for a wedged review.
            let fullFiles: Awaited<ReturnType<VcsAppService["listPullRequestFiles"]>> = []
            try {
                fullFiles = await vcs.listPullRequestFiles(pr.number)
            } catch {
                throw e
            }
            if (fullFiles.length === 0) throw e
            const fallback: ReviewRunScope = {
                ...scope,
                scope: "full",
                code: "dispatch_refused",
                reason: "the analyser refused an incremental request, so this round reviewed everything",
                reviewedFiles: fullFiles.length,
                carried: [],
                reJudgedBlockers: [],
            }
            // Rewritten on the row BEFORE the retry: the callback merges from
            // this record, and a row still claiming to carry eleven findings
            // that the retry did not send would put them back into a review that
            // never looked at them.
            await tryOrNull(() =>
                this.store.upsertTracking({
                    projectId: project.id,
                    prNumber: pr.number,
                    githubCommentId: commentId,
                    headSha: pr.headSha,
                    status: "analysing",
                    reviewProfileId: profile?.id ?? null,
                    reviewProfile:
                        profile && policy
                            ? { kind: "profile", id: profile.id, name: profile.name, preset: profile.preset, policy }
                            : { kind: "default" },
                    reviewScope: fallback,
                }),
            )
            await dispatch(fullFiles.map(toAnalyseFile), fallback)
        }
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

        // The rounds BEFORE this one. Read once and used for everything that
        // needs them — the merge, the comment's progress line, the round's own
        // ordinal — because reading them twice is how two answers to "what did
        // the last round say" come to disagree. Read before the new round is
        // appended, which is what makes "previous" mean previous.
        const rounds =
            status === "done" && result
                ? ((await tryOrNull(() => this.store.listRounds(row.projectId, row.prNumber, ROUND_WINDOW))) ?? [])
                : []
        const roundNumber = (rounds[0]?.round ?? 0) + 1

        // THE MERGE. The stored review is carried + re-judged + newly found, as
        // ONE list in result.findings — because that is what MergeGate counts and
        // what both surfaces render. A carried finding living in a side channel
        // would be invisible to both, which is the failure this whole feature is
        // built around.
        //
        // It also runs on a FULL round, where nothing is carried: the provenance
        // stamps (first seen, last verified) are what make a later incremental
        // round's "N carried" chip mean anything, and a full round that skipped
        // them would leave a hole in the history at the one point it is most
        // trustworthy.
        const merged =
            status === "done" && result
                ? mergeRound({
                      produced: result.findings ?? [],
                      carried: row.reviewScope?.carried ?? [],
                      reJudged: row.reviewScope?.reJudgedBlockers ?? [],
                      round: roundNumber,
                      headSha: row.headSha ?? "",
                      degraded: result.degraded === true,
                      verdict: result.verdict,
                      score: result.score,
                      history: rounds.map((r) => ({ round: r.round, findings: r.findings, score: r.score, degraded: r.degraded })),
                  })
                : null

        // Everything downstream — the comment, the stored result, the round —
        // reads THIS object. The analyser's own list is never persisted on its
        // own once a round can carry: the merge is the review.
        // The verdict and score come from the MERGE, not from the analyser, and on
        // an incremental round they can differ. The analyser judged the push; the
        // stored review is the push plus everything carried into it, and a
        // headline that describes the smaller list would say "approve, 10/10"
        // over a findings list containing a blocker. The gate would still hold —
        // it counts `findings` — but every human-facing signal would say the
        // pull request was clean, which is the same failure in nicer clothes.
        const review: PrAnalysis | null = merged
            ? {
                  ...(result as PrAnalysis),
                  findings: merged.findings,
                  verdict: merged.verdict ?? result!.verdict,
                  score: merged.score ?? result!.score,
                  // The reviewer's own one-liner describes what IT looked at.
                  // Keeping it beside a re-derived verdict is how "approve —
                  // no risks found" ends up over a critical.
                  verdict_reason:
                      merged.verdict !== result!.verdict
                          ? `${merged.counts.carried} finding${merged.counts.carried === 1 ? "" : "s"} carried forward from an earlier round still block this pull request.`
                          : result!.verdict_reason,
              }
            : result

        const history = review && merged ? this.commentHistory(rounds, review, roundNumber, row.reviewScope) : undefined

        if (row.githubCommentId != null) {
            const project = await this.projects.findGithubSyncContext(row.projectId)
            if (project && Project.of(project).isSyncReady()) {
                const vcs = this.vcsFor(project)
                if (vcs) {
                    const uiUrl = `${origin}/projects/${row.projectId}/pulls/${row.prNumber}`
                    const body =
                        status === "done" && review
                            ? this.comment.result(review, origin, uiUrl, row.prNumber, row.reviewProfile, history)
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

        await this.store.saveResult(taskId, status, review)

        // The round: this review, at this head, kept so the NEXT one can say what
        // changed instead of replacing the answer. Best-effort — history is worth
        // less than the review it describes, and a failure to record it must not
        // fail the callback that just delivered one.
        if (status === "done" && row.headSha) {
            const scope = row.reviewScope
            await tryOrNull(() =>
                this.store.appendRound({
                    projectId: row.projectId,
                    prNumber: row.prNumber,
                    headSha: row.headSha as string,
                    status,
                    result: review,
                    reviewProfile: row.reviewProfile,
                    // A run with no recorded scope records itself as full. That
                    // is the only honest default: a reader of this row has to be
                    // able to trust that "full" means the reviewer saw
                    // everything, so the uncertain case must be the expensive one.
                    scope: scope?.scope ?? "full",
                    scopeReason: scope?.reason ?? null,
                    prevHeadSha: scope?.prevHeadSha ?? null,
                    baseSha: scope?.baseSha ?? null,
                    commits: scope?.commits ?? [],
                    carriedCount: merged?.counts.carried ?? 0,
                    reviewedFiles: scope?.reviewedFiles ?? null,
                    resolved: merged?.resolved ?? [],
                }),
            )
        }

        await this.continueIfMoved(row, origin)
    }

    /** The compare between two commits, or null when it cannot be had.
     *
     *  Best-effort by contract. A provider that cannot compare (a shallow
     *  mirror, a permissions change, a sha that has been garbage-collected after
     *  a force-push) leaves the round FULL, which is where every round was before
     *  this existed — so the failure mode of the new machinery is the old
     *  behaviour rather than a broken review. */
    private async compareRange(
        vcs: VcsAppService,
        base: string | null,
        head: string | null,
    ): Promise<{ status: Ancestry; files: { filename: string; previousFilename?: string; status: string; patch?: string; additions: number; deletions: number }[]; commits: ReviewRoundCommit[]; truncated: boolean } | null> {
        if (!base || !head || base === head) return null
        try {
            const cmp = await vcs.compareCommits(base, head)
            if (cmp.commits.length === 0) {
                console.warn(
                    `[pr-review] compare ${base.slice(0, 7)}..${head.slice(0, 7)} returned no commits — ` +
                        `the round will have no timeline and the scope decision has nothing to scope to.`,
                )
            }
            return {
                status: cmp.status,
                files: cmp.files,
                commits: cmp.commits.map((c) => ({
                    sha: c.sha,
                    subject: subjectOf(c.message),
                    author: c.author,
                    at: c.committedAt,
                })),
                truncated: cmp.truncated,
            }
        } catch (e) {
            // Best-effort, but never SILENT. Falling back to a full review is the
            // right behaviour and an invisible one: "the provider could not
            // compare" and "the rules chose full" produce identical output, so
            // without this line a broken compare looks like a working pipeline
            // for as long as anyone cares to watch it.
            console.warn(
                `[pr-review] could not compare ${base.slice(0, 7)}..${head.slice(0, 7)} — this round reviews ` +
                    `the whole pull request and carries nothing. Cause: ${e instanceof Error ? e.message : String(e)}`,
            )
            return null
        }
    }

    /** The push's files, each carrying its WHOLE-PULL-REQUEST patch.
     *
     *  The scope stays the push — these are the only files sent, and the carry
     *  rule still keys off what the push changed. What widens is each file's
     *  CONTENT, and it has to.
     *
     *  The reviewer's checkout is the last-indexed working copy, which is the
     *  default branch. A file this pull request CREATES has never existed in it.
     *  On a full round that was invisible: the whole-PR patch of an added file is
     *  its entire content, so the reviewer read it out of the diff. Send only the
     *  push's hunks and a file created three commits ago is in neither the
     *  checkout nor the diff — so the reviewer opens it, finds nothing, and
     *  concludes the change targets files that do not exist. Observed on MR !4
     *  round 4: three files in the push, zero findings, and an impact section
     *  describing the pre-PR codebase with confidence.
     *
     *  One extra provider call per incremental round, and it buys back the
     *  reviewer's ability to verify anything at all. It is also not the expensive
     *  part — fetching a diff never was; READING twelve files was, and this still
     *  sends three. Best-effort: on failure the push's own patches go, which is
     *  the behaviour that produced the bug but is better than no review. */
    private async cumulativePatches(
        vcs: VcsAppService,
        prNumber: number,
        pushFiles: PrAnalyseFile[],
    ): Promise<{ files: PrAnalyseFile[]; manifest: { path: string; status?: string }[] }> {
        // An explicit catch, NOT tryOrNull: that helper only swallows
        // RepositoryError, and a provider failure here is a plain Error from the
        // adapter — it would propagate out of start(), leaving the loading
        // comment up and no review behind it. Widening the content must not be
        // able to cost the review.
        let whole: Awaited<ReturnType<VcsAppService["listPullRequestFiles"]>>
        try {
            whole = await vcs.listPullRequestFiles(prNumber)
        } catch (e) {
            console.warn(
                `[pr-review] could not read the pull request's full file list for pr ${prNumber} — ` +
                    `the reviewer gets this push's hunks only, and may not be able to see files an ` +
                    `earlier commit created. Cause: ${e instanceof Error ? e.message : String(e)}`,
            )
            return { files: pushFiles, manifest: [] }
        }
        if (whole.length === 0) return { files: pushFiles, manifest: [] }

        const byPath = new Map(whole.map((f) => [f.filename, f]))
        const files = pushFiles.map((f) => {
            // Renames are looked up both ways: the push may name the new path
            // while the pull request's list still keys the old one, or the
            // reverse, depending on where in the range the rename happened.
            const full = byPath.get(f.path) ?? (f.previous_path ? byPath.get(f.previous_path) : undefined)
            if (!full?.patch) return f
            return {
                ...f,
                patch: full.patch,
                status: full.status,
                additions: full.additions,
                deletions: full.deletions,
            }
        })

        // The manifest is the same read, so it costs nothing extra. Paths and
        // status only — enough for the reviewer to know what the pull request
        // contains, not enough to tempt it into reviewing any of it.
        //
        // With ONE exception: a file the push's diff imports, which the pull
        // request itself adds, travels with its content. Paths alone stopped the
        // reviewer asserting such a file was absent; they did not stop it
        // ripgrepping for a symbol, finding nothing, and raising a finding about
        // a contract it "could not verify". A tool result beats an instruction,
        // so the file has to actually be there.
        const bare = whole.map((f) => ({ path: f.filename, status: f.status }))
        const imported = new Set(importedPullRequestFiles(files, bare))
        const byName = new Map(whole.map((f) => [f.filename, f]))
        const manifest = bare.map((m) =>
            imported.has(m.path) && byName.get(m.path)?.patch
                ? { ...m, patch: byName.get(m.path)!.patch }
                : m,
        )
        if (imported.size > 0) {
            console.info(
                `[pr-review] sending ${imported.size} imported file(s) as context: ${[...imported].join(", ")}`,
            )
        }
        return { files, manifest }
    }

    /** The largest dependent count among the symbols this push changed, or null.
     *
     *  This is the "looks small, isn't" rule: a one-line edit to a shared kernel
     *  function is the case a scope decision most needs to get right, and it is
     *  the case a model reading a diff is worst at. `get_neighbours` already
     *  answers it — it is a lookup, not an inference.
     *
     *  Null on ANY failure, and null is not an alarm: the count escalates a round
     *  to full, so treating an unavailable graph as "escalate" would make every
     *  blip cost six minutes. Capped at a handful of symbols because the answer
     *  is a maximum, and the symbols a push changes are rarely more than a few. */
    private async maxDependents(repoId: string, cell: Parameters<AnalyserResolver>[0], symbols: string[]): Promise<number | null> {
        if (symbols.length === 0) return null
        const probes = symbols.slice(0, DEPENDENT_PROBES)
        const counts = await Promise.all(
            probes.map(async (symbol) => {
                try {
                    const r = await this.analyserFor(cell).neighbours({
                        repoId,
                        symbol,
                        edges: ["IMPORTS", "CALLS", "IMPLEMENTS", "EXTENDS"],
                        direction: "in",
                        limit: 200,
                    })
                    return r.neighbours.length
                } catch {
                    return null
                }
            }),
        )
        const known = counts.filter((c): c is number => c != null)
        return known.length > 0 ? Math.max(...known) : null
    }

    /** What the comment needs to know about earlier rounds.
     *
     *  The delta itself is computed by the pure domain (diffRounds) from the two
     *  finding lists — never asked of the model, and never derived twice. This
     *  method only shapes what the caller already read. */
    private commentHistory(rounds: ReviewRound[], result: PrAnalysis, round: number, scope: ReviewRunScope | null) {
        if (rounds.length === 0) return undefined

        const [previous, ...earlier] = rounds // newest first
        const delta = diffRounds(
            { headSha: "", findings: result.findings ?? [], degraded: result.degraded === true },
            { headSha: previous.headSha, findings: previous.findings },
            earlier.map((r) => ({ headSha: r.headSha, findings: r.findings })),
        )
        const remaining = (result.findings ?? []).filter(isBlocker).length

        return {
            round,
            fixed: delta.counts.fixed,
            remaining,
            withheld: delta.withheld,
            // This push, so a reader can see WHICH commits the round was
            // answering. The round table that used to live here is gone: a
            // pull-request comment is read on a phone, in a notification,
            // between other things, and the question it has to answer is "what
            // do I have to fix now". History belongs where it can be navigated.
            commits: scope?.commits ?? [],
            scope: scope?.scope ?? "full",
            carried: (result.findings ?? []).filter((f) => f.provenance?.carried === true).length,
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
