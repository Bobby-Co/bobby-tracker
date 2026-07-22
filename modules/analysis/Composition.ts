// Analysis module — composition root. Wires the Analyser port to its HTTP adapter
// and assembles the two analysis-orchestration services with their ports (the
// analyser, the issue-sync store, the projects + project-analyser repositories,
// the PR-analysis store, and the vcs app-service resolver). A future host or a
// service extraction swaps ONLY this file — callers depend on getAnalyser() /
// the service factories, never on the transport or the concrete collaborators.

import { createServiceClient } from "@/lib/supabase/server"
import { createServiceIssueSyncStore } from "@/modules/issues"
import { createSupabaseProjectsRepository } from "@/modules/projects"
import { getVcsAppService } from "@/modules/vcs"
import type { Analyser } from "./ports/Analyser"
import { HttpAnalyser } from "./infrastructure/HttpAnalyser"
import { createSupabaseProjectAnalyserRepository } from "./infrastructure/SupabaseProjectAnalyserRepository"
import { createServicePullRequestAnalysisStore } from "./infrastructure/SupabasePullRequestAnalysisStore"
import { IssueAnalysisComment } from "./infrastructure/IssueAnalysisComment"
import { PullRequestAnalysisComment } from "./infrastructure/PullRequestAnalysisComment"
import { IssueAnalysisService } from "./infrastructure/IssueAnalysisService"
import { PullRequestAnalysisService } from "./infrastructure/PullRequestAnalysisService"

/** The app-wide Analyser (the HTTP-backed adapter today). */
export function getAnalyser(): Analyser {
    return new HttpAnalyser()
}

/** The issue auto-analysis service, bound to service-role collaborators. */
export function createIssueAnalysisService(): IssueAnalysisService {
    const svc = createServiceClient()
    return new IssueAnalysisService(
        getAnalyser(),
        createServiceIssueSyncStore(),
        createSupabaseProjectsRepository(svc),
        createSupabaseProjectAnalyserRepository(svc),
        getVcsAppService,
        new IssueAnalysisComment(),
    )
}

/** The PR-analysis service, bound to service-role collaborators. */
export function createPullRequestAnalysisService(): PullRequestAnalysisService {
    const svc = createServiceClient()
    return new PullRequestAnalysisService(
        getAnalyser(),
        createSupabaseProjectsRepository(svc),
        createSupabaseProjectAnalyserRepository(svc),
        createServicePullRequestAnalysisStore(),
        getVcsAppService,
        new PullRequestAnalysisComment(),
    )
}
