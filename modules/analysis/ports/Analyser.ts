// Analysis module — the ANALYSER PORT (role name; was AnalyserPort). The interface
// the app depends on to talk to the external bobby-analyser microservice; the
// concrete HTTP transport lives in ../infrastructure/HttpAnalyser and is wired at
// ../Composition. Callers obtain an implementation through getAnalyser() and never
// construct the adapter directly — that seam is what lets a future host inject a
// different transport (in-proc → HTTP/RPC) when Analysis is extracted.

import type {
    QueryResult,
    ChatHistoryMessage,
    IssueAnalyseInput,
    IssueAnalysis,
    PrAnalyseInput,
    IssuePreferences,
    AnalyseEffort,
    IssueComposeInput,
    IssueComposeProposal,
    EmbedResult,
    VerifyInput,
    VerifyReport,
    KickoffJobInput,
    KickoffResult,
    AnalyserRunCallback,
    DeepDiveResult,
} from "./AnalyserTypes"

/** The tracker's outbound contract to the bobby-analyser service. Methods reject
 *  with AnalyserError on transport/protocol failure; the cancel/* methods are
 *  best-effort and resolve even on an unknown task. */
export interface Analyser {
    // ─── /query — one-shot Q&A against an indexed graph ──────────────────────
    query(repoId: string, question: string, maxBudgetUsd?: number): Promise<QueryResult>

    // ─── /chat — streaming SSE; returns the raw Response to pipe to the browser ─
    streamChat(
        repoId: string,
        question: string,
        history?: ChatHistoryMessage[],
        maxBudgetUsd?: number,
        projectId?: string,
        conversationId?: string,
    ): Promise<Response>

    // ─── /issues/analyse — synchronous structured issue analysis ─────────────
    analyseIssue(input: IssueAnalyseInput): Promise<IssueAnalysis>
    /** /issues/analyse/run — detached, cancellable; result POSTed to `callback`. */
    startIssueAnalysis(input: IssueAnalyseInput, taskId: string, callback: AnalyserRunCallback): Promise<void>
    /** /issues/analyse/cancel — best-effort; a finished/unknown task is a no-op. */
    cancelIssueAnalysis(taskId: string): Promise<void>

    // ─── /pr/analyse — detached agentic PR review ────────────────────────────
    startPRAnalysis(input: PrAnalyseInput, taskId: string, callback: AnalyserRunCallback): Promise<void>
    cancelPRAnalysis(taskId: string): Promise<void>
    /** /pr/insight/{id}/deep-dive — materialise a stored insight into a chat. */
    deepDivePRInsight(insightId: string): Promise<DeepDiveResult>

    // ─── /issues/preferences — per-project default analyse effort ────────────
    getIssuePreferences(repoId: string): Promise<IssuePreferences>
    setIssuePreferences(repoId: string, effort: AnalyseEffort | ""): Promise<IssuePreferences>

    // ─── /issues/compose — AI draft from paragraph + images ──────────────────
    compose(input: IssueComposeInput): Promise<IssueComposeProposal>

    // ─── /embeddings ─────────────────────────────────────────────────────────
    embed(text: string): Promise<EmbedResult>

    // ─── /verify — no-LLM graph-health check ─────────────────────────────────
    verify(input: VerifyInput): Promise<VerifyReport>

    // ─── /jobs/run — start indexing (fire-and-forget, ~50ms) ─────────────────
    startIndex(input: KickoffJobInput): Promise<KickoffResult>
    /** /graphs/delete — tear down a repo's knowledge graph. Idempotent. */
    deleteGraph(graphId: string): Promise<void>
}
