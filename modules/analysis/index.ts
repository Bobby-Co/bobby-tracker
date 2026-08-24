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
export {
    createIssueAnalysisService,
    createPullRequestAnalysisService,
    createExhaustionSweep,
    createRunQueue,
} from "./Composition"

// ─── review profiles — what kind of reviewer a team wants (0077) ─────────────
// The DOMAIN (vocabulary, presets, sanitisation) is exported here for servers.
// Client components must import modules/analysis/domain/ReviewProfile DIRECTLY:
// this barrel re-exports Composition, which reaches next/headers and fails the
// browser build. The domain files import nothing, which is what makes that safe.
export type {
    Dials, Depth, PathRule, Preset, ReviewProfile, ReviewPolicyWire, LensSpec, DialSpec,
} from "./domain/ReviewProfile"
export {
    DEFAULT_DIALS, DEFAULT_LENSES, DIAL_SPECS, LENSES, PRESETS, PRESET_KEYS,
    affectsMergeGate, clampDepth, compilePolicy, matchingPreset, parseDials, parseLenses, presetByKey,
} from "./domain/ReviewProfile"
export { LIMITS as REVIEW_INSTRUCTION_LIMITS, sanitiseInstructions } from "./domain/ReviewInstructions"
export type { SanitisedInstructions, InstructionIssue } from "./domain/ReviewInstructions"
export type { ReviewProfileRepository, ReviewProfileInput } from "./ports/ReviewProfileRepository"
export { createSupabaseReviewProfileRepository } from "./infrastructure/SupabaseReviewProfileRepository"

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

// ─── run admission: the per-team concurrency bound on billable work ──────────
export { RunAdmission } from "./application/RunAdmission"
export type { TeamRunRegistry, ActiveRun, ActiveRunKind } from "./ports/TeamRunRegistry"
export { createSupabaseTeamRunRegistry } from "./infrastructure/SupabaseTeamRunRegistry"
export { ExhaustionSweep } from "./application/ExhaustionSweep"
export { RunQueue } from "./application/RunQueue"
export type { QueuedDispatcher, DrainResult } from "./application/RunQueue"
export type { RunCanceller, SweepResult } from "./application/ExhaustionSweep"
