// MeteringAnalyser — the metering DECORATOR around the Analyser port. Every model
// call in the product funnels through getAnalyser(); wrapping that one seam is how
// "count every model call" is satisfied without touching a dozen call sites'
// logic. A route swaps `getAnalyser()` → `getMeteredAnalyser({ teamId, userId })`
// and its calls are now billed — the analysis module stays entirely unaware of
// billing (billing depends on analysis, never the reverse).
//
// It delegates the whole Analyser interface to the inner adapter and OVERRIDES
// only the synchronous, cost-bearing methods, recording a usage event after each
// returns. The detached run paths (startIssueAnalysis/startPRAnalysis) and the SSE
// stream (streamChat) report their usage asynchronously — via the run callback /
// stream trailer — so they're metered where that result lands, not here, and pass
// straight through untouched.

import type { Analyser } from "@/modules/analysis"
import type {
    IssueAnalyseInput,
    IssueAnalysis,
    IssueComposeInput,
    IssueComposeProposal,
    EmbedResult,
    QueryResult,
} from "@/modules/analysis"
import { pointsForUsage } from "../domain/ProwlPoints"
import type { BillingSubject, UsageRecorder } from "../ports/UsageRecorder"

export class MeteringAnalyser implements Analyser {
    constructor(
        private readonly inner: Analyser,
        private readonly subject: BillingSubject,
        private readonly recorder: UsageRecorder,
        /** Optional project this run belongs to — denormalised onto the event. */
        private readonly projectId?: string,
    ) {}

    // ─── metered: synchronous, cost/usage-bearing calls ──────────────────────
    async analyseIssue(input: IssueAnalyseInput): Promise<IssueAnalysis> {
        const result = await this.inner.analyseIssue(input)
        await this.meter("issue_analyse", { costUsd: result.cost_usd }, { model: result.local ? "local" : null })
        return result
    }

    async query(repoId: string, question: string, maxBudgetUsd?: number): Promise<QueryResult> {
        const result = await this.inner.query(repoId, question, maxBudgetUsd)
        await this.meter("query", { costUsd: result.cost_usd })
        return result
    }

    async compose(input: IssueComposeInput): Promise<IssueComposeProposal> {
        const result = await this.inner.compose(input)
        await this.meter(
            "compose",
            {
                inputTokens: result.usage?.prompt_tokens,
                outputTokens: result.usage?.completion_tokens,
                totalTokens: result.usage?.total_tokens,
            },
            { model: result.model },
        )
        return result
    }

    async embed(text: string): Promise<EmbedResult> {
        const result = await this.inner.embed(text)
        await this.meter(
            "embed",
            { inputTokens: result.usage?.prompt_tokens, totalTokens: result.usage?.total_tokens },
            { model: result.model },
        )
        return result
    }

    /** Record one usage event. Best-effort — the recorder swallows its own errors,
     *  and we compute points from whatever signal the call returned. */
    private async meter(
        kind: string,
        signal: { costUsd?: number | null; inputTokens?: number | null; outputTokens?: number | null; totalTokens?: number | null },
        extra?: { model?: string | null },
    ): Promise<void> {
        await this.recorder.record({
            teamId: this.subject.teamId,
            userId: this.subject.userId,
            kind,
            model: extra?.model ?? null,
            points: pointsForUsage(signal),
            costUsd: signal.costUsd ?? null,
            inputTokens: signal.inputTokens ?? null,
            outputTokens: signal.outputTokens ?? null,
            projectId: this.projectId ?? null,
        })
    }

    // ─── pass-through: metered elsewhere or non-LLM ──────────────────────────
    streamChat: Analyser["streamChat"] = (...a) => this.inner.streamChat(...a)
    startIssueAnalysis: Analyser["startIssueAnalysis"] = (...a) => this.inner.startIssueAnalysis(...a)
    cancelIssueAnalysis: Analyser["cancelIssueAnalysis"] = (...a) => this.inner.cancelIssueAnalysis(...a)
    startPRAnalysis: Analyser["startPRAnalysis"] = (...a) => this.inner.startPRAnalysis(...a)
    cancelPRAnalysis: Analyser["cancelPRAnalysis"] = (...a) => this.inner.cancelPRAnalysis(...a)
    deepDivePRInsight: Analyser["deepDivePRInsight"] = (...a) => this.inner.deepDivePRInsight(...a)
    getIssuePreferences: Analyser["getIssuePreferences"] = (...a) => this.inner.getIssuePreferences(...a)
    setIssuePreferences: Analyser["setIssuePreferences"] = (...a) => this.inner.setIssuePreferences(...a)
    verify: Analyser["verify"] = (...a) => this.inner.verify(...a)
    startIndex: Analyser["startIndex"] = (...a) => this.inner.startIndex(...a)
    deleteGraph: Analyser["deleteGraph"] = (...a) => this.inner.deleteGraph(...a)
}
