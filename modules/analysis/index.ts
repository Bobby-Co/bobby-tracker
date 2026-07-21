// Analysis module — PUBLIC CONTRACT (see modules/README.md). Grows as analyser
// gating/orchestration logic migrates in from lib/github-sync.ts and lib/pr-sync.ts.

// ─── ProjectAnalyser aggregate — analyser readiness + status ─────────────────
// Readiness is `ProjectAnalyser.from(state).isReady()` — call it directly at the
// site (it's null-safe); there is no free-function wrapper.
export type { ProjectAnalyserState, AnalyserStatusValue, AnalyseEffort } from "./domain/project-analyser"
export { ProjectAnalyser } from "./domain/project-analyser"

// ─── project_analyser repository (Phase 1: inline .from() → repository) ──────
export type { AnalyserReadinessRow, ProjectAnalyserRepository } from "./ports/project-analyser-repository"
export { createSupabaseProjectAnalyserRepository } from "./infrastructure/supabase-project-analyser-repository"

// ─── Auto-analysis orchestration (durable, cancellable bot-comment lifecycle) ─
// Moved in from the vcs module: the analyser-run lifecycle is an analysis
// concern; the GitHub side is just a comment posted via vcs' VCSAppService.
export { ensureAnalysis, applyAnalysisResult, cancelAnalysis } from "./infrastructure/issue-analysis-flow"
export { startPRAnalysis, applyPRResult, cancelPRAnalysisForPR } from "./infrastructure/pr-analysis-flow"
export type { PRInput } from "./infrastructure/pr-analysis-flow"

// ─── The analyser port + its composition seam ───────────────────────────────
// Callers depend on the AnalyserPort interface and obtain an implementation via
// getAnalyser(); they must NOT import the analyser adapter's functions directly.
export type { AnalyserPort, AnalyserRunCallback, DeepDiveResult } from "./ports/analyser-port"
export { getAnalyser } from "./composition"

// ─── Re-exported analyser surface ───────────────────────────────────────────
// So a call site gets its whole analyser dependency from this module contract
// rather than reaching into the analyser adapter (infrastructure/analyser): the
// error class and the wire DTOs. (Effort validity + value set live on the
// ProjectAnalyser aggregate above; transport-only WS types — JobSpec/JobResult —
// are intentionally excluded: they belong to the CLI-only runJob path.)
export { AnalyserError } from "./infrastructure/analyser"
export type {
    QueryResult,
    ChatResult,
    ChatCitation,
    ChatIssue,
    ChatHistoryMsg,
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
    PRAnalyseFile,
    PRAnalyseInput,
    IssuePreferences,
    KickoffJobInput,
    KickoffResult,
} from "./infrastructure/analyser"
