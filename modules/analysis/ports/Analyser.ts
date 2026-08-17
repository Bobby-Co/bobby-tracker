// Analysis module — the ANALYSER PORT (role name; was AnalyserPort). The interface
// the app depends on to talk to the external bobby-analyser microservice; the
// concrete HTTP transport lives in ../infrastructure/HttpAnalyser and is wired at
// ../Composition. Callers obtain an implementation through getAnalyser() and never
// construct the adapter directly — that seam is what lets a future host inject a
// different transport (in-proc → HTTP/RPC) when Analysis is extracted.

import type { CellId } from "@/modules/regions"
import type {
    AnalyserBilling,
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
    RetrieveInput,
    RetrieveResult,
    NeighboursInput,
    NeighboursResult,
} from "./AnalyserTypes"

/** The tracker's outbound contract to the bobby-analyser service. Methods reject
 *  with AnalyserError on transport/protocol failure; the cancel/* methods are
 *  best-effort and resolve even on an unknown task. */
export interface Analyser {
    // ─── /query — one-shot Q&A against an indexed graph ──────────────────────
    query(repoId: string, question: string, maxBudgetUsd?: number): Promise<QueryResult>

    // ─── /retrieve — ranked file cards, no synthesis, no source ──────────────
    /** Which files matter for a goal, why they ranked, and the module/cluster
     *  prose baked at index time. Backs the MCP `locate_files` tool. */
    retrieve(input: RetrieveInput): Promise<RetrieveResult>

    // ─── /neighbours — one graph hop, no model ───────────────────────────────
    /** Callers/callees/imports/implementors of an anchor node, file or symbol.
     *  Backs the MCP `get_neighbours` tool. */
    neighbours(input: NeighboursInput): Promise<NeighboursResult>

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
    /** `billing` is optional so a caller with no team in hand still works, but
     *  omitting it means the call is spent and never recorded. Pass it. */
    embed(text: string, billing?: AnalyserBilling): Promise<EmbedResult>

    // ─── /verify — no-LLM graph-health check ─────────────────────────────────
    verify(input: VerifyInput): Promise<VerifyReport>

    // ─── /jobs/run — start indexing (fire-and-forget, ~50ms) ─────────────────
    startIndex(input: KickoffJobInput): Promise<KickoffResult>
    /** /graphs/delete — tear down a repo's knowledge graph. Idempotent. */
    deleteGraph(graphId: string): Promise<void>
}

/** Resolves the Analyser serving a cell — `getAnalyser` itself.
 *
 *  Injected (rather than a fixed Analyser) into services that only learn which
 *  cell they need partway through a flow, once they've resolved the project.
 *  Same shape and reasoning as the VcsAppServiceResolver the vcs module injects.
 *  Omitting the cell selects the home cell; see getAnalyser for when that is and
 *  isn't correct. */
export type AnalyserResolver = (cell?: CellId) => Analyser
