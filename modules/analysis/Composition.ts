// Analysis module — composition root. Wires the Analyser port to its HTTP adapter
// and assembles the two analysis-orchestration services with their ports (the
// analyser, the issue-sync store, the projects + project-analyser repositories,
// the PR-analysis store, and the vcs app-service resolver). A future host or a
// service extraction swaps ONLY this file — callers depend on getAnalyser() /
// the service factories, never on the transport or the concrete collaborators.

import { Supabase, type SupabaseRlsClient } from "@/lib/server/supabase"
import { createServiceIssueSyncStore, IssuePrompt } from "@/modules/issues"
import { createSupabaseProjectsRepository } from "@/modules/projects"
import { getRegionRegistry, type CellId } from "@/modules/regions"
import { createSupabasePullRequestReadRepository, getVcsAppService } from "@/modules/vcs"
import { createSupabaseSubscriptionsRepository, getRunAllowance, getSpendGate } from "@/modules/billing"
import type { Analyser } from "./ports/Analyser"
import { HttpAnalyser } from "./infrastructure/HttpAnalyser"
import { createSupabaseProjectAnalyserRepository } from "./infrastructure/SupabaseProjectAnalyserRepository"
import { createSupabaseProjectBranchRepository } from "./infrastructure/SupabaseProjectBranchRepository"
import { createServicePullRequestAnalysisStore } from "./infrastructure/SupabasePullRequestAnalysisStore"
import { IssueAnalysisComment } from "./infrastructure/IssueAnalysisComment"
import { PullRequestAnalysisComment } from "./infrastructure/PullRequestAnalysisComment"
import { createSupabaseReviewProfileRepository } from "./infrastructure/SupabaseReviewProfileRepository"
import { IssueAnalysisService } from "./infrastructure/IssueAnalysisService"
import { PullRequestAnalysisService } from "./infrastructure/PullRequestAnalysisService"
import { RunAdmission } from "./application/RunAdmission"
import { ExhaustionSweep } from "./application/ExhaustionSweep"
import { RunQueue } from "./application/RunQueue"
import { createSupabaseTeamRunRegistry } from "./infrastructure/SupabaseTeamRunRegistry"

/** The Analyser serving one CELL (the HTTP-backed adapter today).
 *
 *  Routing is per cell, not per region: a region may hold several cells and only
 *  one of them has this project's graph. Omitting `cell` selects the HOME cell,
 *  which is correct only for work that touches no repo graph — embeddings, issue
 *  composition, icon search. Anything addressing a project's graph (index, chat,
 *  analyse, retrieve, verify, delete) MUST pass that project's cell, or it lands
 *  on an analyser that has never indexed the repo and answers with a confident
 *  empty result rather than an error. */
export function getAnalyser(cell?: CellId): Analyser {
    const registry = getRegionRegistry()
    const cfg = registry.cell(cell ?? registry.homeCell())
    return new HttpAnalyser({ cell: cfg.id, baseUrl: cfg.analyserUrl, token: cfg.analyserToken })
}

/** Service-role clients, one per plane. `project_analyser` and `projects` are
 *  CONTROL-plane; the PR mirror, `issues` and `pull_request_analyses` are DATA.
 *
 *  `dataDb` is supplied by callers that know the project (resolve it with
 *  dataClientForProject). Omitted, both planes are central — correct for a
 *  project whose team has not been moved to a region of its own, and the state
 *  every project is in until it has. */
function servicePlanes(dataDb?: SupabaseRlsClient) {
    const controlDb = Supabase.service()
    return { dataDb: dataDb ?? controlDb, controlDb }
}

/** The per-team concurrency bound, over the planes this module's run rows live
 *  in. Built here rather than in the billing composition root on purpose: billing
 *  owns the ALLOWANCE (a tier attribute) but counting runs means reading `issues`
 *  and `pull_request_analyses`, which are this module's tables — and importing
 *  this module from billing's root would put a cycle between the two. */
function runAdmission(controlDb: SupabaseRlsClient, dataDb: SupabaseRlsClient): RunAdmission {
    return new RunAdmission(getRunAllowance(), createSupabaseTeamRunRegistry(controlDb, dataDb))
}

/** The issue auto-analysis service, bound to service-role collaborators. */
export function createIssueAnalysisService(dataDb?: SupabaseRlsClient): IssueAnalysisService {
    const { dataDb: data, controlDb } = servicePlanes(dataDb)
    return new IssueAnalysisService(
        getAnalyser,
        createServiceIssueSyncStore(data),
        createSupabaseProjectsRepository(controlDb),
        createSupabaseProjectAnalyserRepository(controlDb),
        getVcsAppService,
        new IssueAnalysisComment(),
        new IssuePrompt(),
        // The billing hard gate: a paused team analyses nothing, including via the
        // webhooks that reach this service with no session behind them.
        getSpendGate(),
        // The burst bound. The gate above cannot see work that started since the
        // analyser last flushed its meter; this can.
        runAdmission(controlDb, data),
        // Tracked branches, so an issue filed against one is investigated
        // against that branch's graph rather than the trunk. CONTROL plane,
        // with the projects they configure — same reasoning as the PR service.
        createSupabaseProjectBranchRepository(controlDb),
    )
}

/** The PR-analysis service, bound to service-role collaborators. */
export function createPullRequestAnalysisService(dataDb?: SupabaseRlsClient): PullRequestAnalysisService {
    const { dataDb: data, controlDb } = servicePlanes(dataDb)
    return new PullRequestAnalysisService(
        getAnalyser,
        createSupabaseProjectsRepository(controlDb),
        createSupabaseProjectAnalyserRepository(controlDb),
        createServicePullRequestAnalysisStore(data),
        getVcsAppService,
        new PullRequestAnalysisComment(),
        getSpendGate(),
        runAdmission(controlDb, data),
        // Profiles are TEAM-owned and live in the control plane alongside teams
        // and billing, not with the project's regional content — a team cannot
        // span regions, so its reviewer configuration has one home.
        createSupabaseReviewProfileRepository(controlDb),
        // Read only to cap review DEPTH by plan. Control plane: a subscription
        // belongs to a team, same as the profile it caps.
        createSupabaseSubscriptionsRepository(controlDb),
        // The PR mirror, for restarting a review when the head moved while one
        // was running (0080). REGIONAL, with the pull requests it mirrors and
        // the analyses beside them.
        createSupabasePullRequestReadRepository(data),
        // Tracked branches, so a pull request into one is reviewed against that
        // branch's graph. CONTROL plane, with the projects they configure — the
        // branch list is per-project config, not regional content.
        createSupabaseProjectBranchRepository(controlDb),
    )
}

/** The exhaustion sweep — cancels a team's in-flight runs when it may no longer
 *  spend. Fired by the usage-rollup trigger (0084) through
 *  POST /api/internal/spend-sweep.
 *
 *  `dataDb` must be bound to the TEAM's cell: the runs it cancels, and the rows
 *  it reads to find them, are regional. */
export function createExhaustionSweep(dataDb?: SupabaseRlsClient): ExhaustionSweep {
    const { dataDb: data, controlDb } = servicePlanes(dataDb)
    const issues = createIssueAnalysisService(data)
    const pulls = createPullRequestAnalysisService(data)
    return new ExhaustionSweep(getSpendGate(), createSupabaseTeamRunRegistry(controlDb, data), {
        cancelIssue: (issueId) => issues.cancel(issueId),
        cancelPr: (projectId, prNumber) => pulls.cancel(projectId, prNumber),
    })
}

/** The queue drain — starts what the concurrency cap deferred (0085).
 *
 *  `dataDb` must be bound to the team's cell, like the sweep: the queued rows and
 *  the runs they become are regional. */
export function createRunQueue(dataDb?: SupabaseRlsClient): RunQueue {
    const { dataDb: data, controlDb } = servicePlanes(dataDb)
    const issues = createIssueAnalysisService(data)
    const pulls = createPullRequestAnalysisService(data)
    return new RunQueue(
        getSpendGate(),
        getRunAllowance(),
        createSupabaseTeamRunRegistry(controlDb, data),
        createSupabaseProjectsRepository(controlDb),
        {
            // fromQueue: this issue is ALREADY marked 'queued', and without the
            // flag ensure() would helpfully report it as queued and do nothing —
            // the drain is the one caller for whom that state is the reason to
            // proceed rather than to stop.
            startIssue: (issueId, origin) => issues.ensure(issueId, origin, { fromQueue: true }).then(() => undefined),
            startPr: (projectId, prNumber, origin) => pulls.startQueued(projectId, prNumber, origin),
        },
    )
}
