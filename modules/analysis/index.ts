// Analysis module — PUBLIC CONTRACT (see modules/README.md). Grows as analyser
// gating/orchestration logic migrates in from lib/github-sync.ts and lib/pr-sync.ts.

export { isAnalyserReady } from "./domain/analyser-readiness"

// ─── The analyser port + its composition seam ───────────────────────────────
// Callers depend on the AnalyserPort interface and obtain an implementation via
// getAnalyser(); they must NOT import @/lib/analyser's functions directly.
export type { AnalyserPort, AnalyserRunCallback, DeepDiveResult } from "./ports/analyser-port"
export { getAnalyser } from "./composition"

// ─── Re-exported analyser surface ───────────────────────────────────────────
// So a call site gets its whole analyser dependency from this module contract
// rather than reaching into @/lib/analyser: the error class, the pure effort
// helpers, and the wire DTOs. (Transport-only WS types — JobSpec/JobResult/etc. —
// are intentionally excluded: they belong to the CLI-only runJob path.)
export { AnalyserError, ANALYSE_EFFORTS, isAnalyseEffort } from "@/lib/analyser"
export type {
    AnalyseEffort,
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
} from "@/lib/analyser"
