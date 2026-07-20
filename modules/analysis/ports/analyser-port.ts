// Analysis module — the ANALYSER PORT. This is the interface the app depends on
// to talk to the external bobby-analyser microservice; the concrete HTTP/WS
// client lives in ../infrastructure and is wired at ./composition. Callers
// obtain an implementation through getAnalyser() (see modules/analysis) and never
// import the concrete client directly — that seam is what lets a future host
// inject a different transport (in-proc → HTTP/RPC) when Analysis is extracted as
// its own service (see modules/README.md).
//
// This file is in ports/ (not domain/ or application/), so — like
// modules/projects/ports/projects-repository.ts referencing the DB row type — it
// may TYPE-import the analyser wire DTOs from the analyser adapter (infrastructure/analyser). No client or SDK is
// imported here; the concrete transport stays in infrastructure.

import type {
    QueryResult,
    ChatHistoryMsg,
    IssueAnalyseInput,
    IssueAnalysis,
    PRAnalyseInput,
    IssuePreferences,
    AnalyseEffort,
    IssueComposeInput,
    IssueComposeProposal,
    EmbedResult,
    VerifyInput,
    VerifyReport,
    KickoffJobInput,
    KickoffResult,
} from "../infrastructure/analyser"

/** Where a detached run POSTs its terminal result. `token` (when set) is sent as
 *  `Authorization: Bearer <token>` on the callback. */
export interface AnalyserRunCallback {
    url: string
    token?: string
}

/** What deepDivePRInsight materialises: a fresh chat conversation seeded with the
 *  stored PR insight's context (analyser ADR-0055). */
export interface DeepDiveResult {
    conversation_id: string
    repo_id?: string
    project_id?: string
    pr_number?: number
    pr_title?: string
}

/** The tracker's outbound contract to the bobby-analyser service. One behavioural
 *  note per method mirrors the adapter's semantics: methods reject with
 *  AnalyserError on transport/protocol failure; the cancel/*  methods are
 *  best-effort and resolve even on an unknown task. The WebSocket `runJob` path
 *  (CLI-only, unused by the app) is deliberately NOT part of this port. */
export interface AnalyserPort {
    // ─── /query — one-shot Q&A against an indexed graph ──────────────────────
    query(repoId: string, question: string, maxBudgetUsd?: number): Promise<QueryResult>

    // ─── /chat — streaming SSE; returns the raw Response to pipe to the browser ─
    streamChat(
        repoId: string,
        question: string,
        history?: ChatHistoryMsg[],
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
    startPRAnalysis(input: PRAnalyseInput, taskId: string, callback: AnalyserRunCallback): Promise<void>
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
