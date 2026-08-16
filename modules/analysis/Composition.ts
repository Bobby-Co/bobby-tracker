// Analysis module — composition root. Wires the Analyser port to its HTTP adapter
// and assembles the two analysis-orchestration services with their ports (the
// analyser, the issue-sync store, the projects + project-analyser repositories,
// the PR-analysis store, and the vcs app-service resolver). A future host or a
// service extraction swaps ONLY this file — callers depend on getAnalyser() /
// the service factories, never on the transport or the concrete collaborators.

import { Supabase } from "@/lib/server/supabase"
import { createServiceIssueSyncStore, IssuePrompt } from "@/modules/issues"
import { createSupabaseProjectsRepository } from "@/modules/projects"
import { getRegionRegistry, type CellId } from "@/modules/regions"
import { getVcsAppService } from "@/modules/vcs"
import type { Analyser } from "./ports/Analyser"
import { HttpAnalyser } from "./infrastructure/HttpAnalyser"
import { createSupabaseProjectAnalyserRepository } from "./infrastructure/SupabaseProjectAnalyserRepository"
import { createServicePullRequestAnalysisStore } from "./infrastructure/SupabasePullRequestAnalysisStore"
import { IssueAnalysisComment } from "./infrastructure/IssueAnalysisComment"
import { PullRequestAnalysisComment } from "./infrastructure/PullRequestAnalysisComment"
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

/** Service-role clients, one per plane. The same client today — naming them
 *  apart is what turns the eventual split into a one-line change here rather
 *  than an audit of which repository reads which table. `project_analyser` is
 *  control-plane (it is in the supabase_realtime publication); `projects` and the
 *  PR mirror are data-plane. */
function servicePlanes() {
    const dataDb = Supabase.service()
    return { dataDb, controlDb: dataDb }
}

/** The issue auto-analysis service, bound to service-role collaborators. */
export function createIssueAnalysisService(): IssueAnalysisService {
    const { dataDb, controlDb } = servicePlanes()
    return new IssueAnalysisService(
        getAnalyser,
        createServiceIssueSyncStore(),
        createSupabaseProjectsRepository(dataDb),
        createSupabaseProjectAnalyserRepository(controlDb),
        getVcsAppService,
        new IssueAnalysisComment(),
        new IssuePrompt(),
    )
}

/** The PR-analysis service, bound to service-role collaborators. */
export function createPullRequestAnalysisService(): PullRequestAnalysisService {
    const { dataDb, controlDb } = servicePlanes()
    return new PullRequestAnalysisService(
        getAnalyser,
        createSupabaseProjectsRepository(dataDb),
        createSupabaseProjectAnalyserRepository(controlDb),
        createServicePullRequestAnalysisStore(),
        getVcsAppService,
        new PullRequestAnalysisComment(),
    )
}
