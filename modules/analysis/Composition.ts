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
import { getVcsAppService } from "@/modules/vcs"
import { createSupabaseSubscriptionsRepository, getSpendGate } from "@/modules/billing"
import type { Analyser } from "./ports/Analyser"
import { HttpAnalyser } from "./infrastructure/HttpAnalyser"
import { createSupabaseProjectAnalyserRepository } from "./infrastructure/SupabaseProjectAnalyserRepository"
import { createServicePullRequestAnalysisStore } from "./infrastructure/SupabasePullRequestAnalysisStore"
import { IssueAnalysisComment } from "./infrastructure/IssueAnalysisComment"
import { PullRequestAnalysisComment } from "./infrastructure/PullRequestAnalysisComment"
import { createSupabaseReviewProfileRepository } from "./infrastructure/SupabaseReviewProfileRepository"
import { IssueAnalysisService } from "./infrastructure/IssueAnalysisService"
import { PullRequestAnalysisService } from "./infrastructure/PullRequestAnalysisService"

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
        // Profiles are TEAM-owned and live in the control plane alongside teams
        // and billing, not with the project's regional content — a team cannot
        // span regions, so its reviewer configuration has one home.
        createSupabaseReviewProfileRepository(controlDb),
        // Read only to cap review DEPTH by plan. Control plane: a subscription
        // belongs to a team, same as the profile it caps.
        createSupabaseSubscriptionsRepository(controlDb),
    )
}
