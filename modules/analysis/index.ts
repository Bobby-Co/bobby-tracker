// Analysis module — PUBLIC CONTRACT (see modules/README.md). The provider-agnostic
// bridge to the bobby-analyser service (the Analyser port + HttpAnalyser adapter),
// the ProjectAnalyser aggregate + repository, and the two analysis-orchestration
// services (issue auto-analysis + PR review).

// ─── ProjectAnalyser aggregate — analyser readiness + status ─────────────────
// Readiness is `ProjectAnalyser.from(state).isReady()` — call it directly at the
// site (it's null-safe); there is no free-function wrapper.
export type { ProjectAnalyserState, AnalyserStatusValue, AnalyseEffort } from "./domain/ProjectAnalyser"
export { ProjectAnalyser } from "./domain/ProjectAnalyser"

// ─── project_analyser repository ─────────────────────────────────────────────
export type { AnalyserReadinessRow, ProjectAnalyserRepository } from "./ports/ProjectAnalyserRepository"
export { createSupabaseProjectAnalyserRepository } from "./infrastructure/SupabaseProjectAnalyserRepository"

// ─── analysis-orchestration services (durable, cancellable bot-comment lifecycle)
// The analyser-run lifecycle is an analysis concern; the GitHub side is just a
// comment posted via the vcs module's VcsAppService. Callers obtain a service via
// its composition factory and call ensure/applyResult/cancel (issues) or
// start/applyResult/cancel (PRs).
export { IssueAnalysisService } from "./infrastructure/IssueAnalysisService"
export { PullRequestAnalysisService } from "./infrastructure/PullRequestAnalysisService"
export type { PrInput, PrProject } from "./infrastructure/PullRequestAnalysisService"
export { createIssueAnalysisService, createPullRequestAnalysisService } from "./Composition"

// ─── the analyser port + its composition seam ───────────────────────────────
// Callers depend on the Analyser interface and obtain an implementation via
// getAnalyser(); they must NOT import the HTTP adapter directly.
export type { Analyser, AnalyserResolver } from "./ports/Analyser"
export { getAnalyser } from "./Composition"

// ─── the analyser wire contract (DTOs + error + callback shapes) ─────────────
export { AnalyserError } from "./ports/AnalyserTypes"
export type {
    AnalyserBilling,
    AnalyserRunCallback,
    DeepDiveResult,
    QueryResult,
    ChatResult,
    ChatCitation,
    ChatIssue,
    ChatHistoryMessage,
    IssueFinding,
    IssueAnalysis,
    IssueAnalyseInput,
    IssueComposePriority,
    IssueComposeConfidence,
    IssueComposeLayer,
    IssueComposeAction,
    IssueComposeScope,
    IssueComposeProposal,
    IssueComposeInput,
    EmbedResult,
    VerifyBrokenCite,
    VerifyStaleNote,
    VerifyContentStaleNote,
    VerifyReport,
    VerifyInput,
    PrAnalyseFile,
    PrAnalyseInput,
    IssuePreferences,
    KickoffJobInput,
    KickoffResult,
    RetrieveHints,
    RetrieveInput,
    RetrieveFile,
    RetrieveFileSymbol,
    RetrieveSymbol,
    RetrieveResult,
    NeighboursInput,
    NeighbourNode,
    NeighboursResult,
} from "./ports/AnalyserTypes"
