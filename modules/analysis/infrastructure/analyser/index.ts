// Server-side client for the bobby-analyser microservice — public surface.
//
// Split from a single 850-line file into per-endpoint modules over a shared
// `client` core (config/auth/error). This barrel re-exports the whole surface so
// `./analyser` resolves unchanged for the port adapter (http-analyser) and the
// module contract. See bobby-analyser/docs/subsystems/server.md.

export { AnalyserError } from "./client"

export type { QueryResult, ChatCitation, ChatIssue, ChatResult, ChatHistoryMsg } from "./query"
export { ask, chatStream } from "./query"

export type { AnalyseEffort, IssueFinding, IssueAnalysis, IssueAnalyseInput, IssuePreferences } from "./issues"
export {
    ANALYSE_EFFORTS,
    isAnalyseEffort,
    analyseIssue,
    runIssueAnalysis,
    cancelIssueAnalysis,
    getIssuePreferences,
    setIssuePreferences,
} from "./issues"

export type {
    IssueComposePriority,
    IssueComposeConfidence,
    IssueComposeLayer,
    IssueComposeAction,
    IssueComposeScope,
    IssueComposeProposal,
    IssueComposeInput,
    EmbedResult,
} from "./compose"
export { composeIssue, embedText } from "./compose"

export type { PRAnalyseFile, PRAnalyseInput } from "./pull-requests"
export { runPRAnalysis, cancelPRAnalysis, deepDivePRInsight } from "./pull-requests"

export type { VerifyBrokenCite, VerifyStaleNote, VerifyContentStaleNote, VerifyReport, VerifyInput } from "./verify"
export { verifyGraph } from "./verify"

export type {
    SupabaseProgressTarget,
    KickoffJobInput,
    KickoffResult,
    JobSpec,
    JobResult,
    JobProgress,
    JobLog,
    RunJobHandlers,
} from "./jobs"
export { kickoffJob, deleteGraph, runJob } from "./jobs"
