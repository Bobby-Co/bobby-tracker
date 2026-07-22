// Analysis infrastructure — the HTTP Analyser adapter. Implements the Analyser
// port by owning ALL the bobby-analyser transport detail: env config, the auth
// header, the fetch per endpoint, and AnalyserError semantics — as real methods,
// not aliases to floating functions. Swapping the transport (or extracting
// Analysis as its own service) means replacing this file; nothing that depends on
// the Analyser port changes.
//
// (The legacy WebSocket /jobs runJob path — CLI-only, unused by the app — is
// intentionally dropped; startIndex uses the fire-and-forget /jobs/run HTTP call.)

import type { Analyser } from "../ports/Analyser"
import { AnalyserError } from "../ports/AnalyserTypes"
import type {
    AnalyserRunCallback,
    AnalyseEffort,
    ChatHistoryMessage,
    DeepDiveResult,
    EmbedResult,
    IssueAnalyseInput,
    IssueAnalysis,
    IssueComposeInput,
    IssueComposeProposal,
    IssuePreferences,
    KickoffJobInput,
    KickoffResult,
    PrAnalyseInput,
    QueryResult,
    VerifyInput,
    VerifyReport,
} from "../ports/AnalyserTypes"

export class HttpAnalyser implements Analyser {
    // ─── transport helpers (private — the vendor detail this adapter owns) ────
    /** The configured analyser base URL (trailing slashes trimmed). Token is
     *  server-only — never shipped to the browser. */
    private base(): string {
        const url = process.env.BOBBY_ANALYSER_URL || ""
        if (!url) throw new AnalyserError("BOBBY_ANALYSER_URL is not set", "not_configured")
        return url.replace(/\/+$/, "")
    }

    private authHeader(): Record<string, string> {
        const token = process.env.BOBBY_ANALYSER_TOKEN || ""
        return token ? { Authorization: `Bearer ${token}` } : {}
    }

    /** Parse an error body and throw AnalyserError with the analyser's code/message
     *  (falling back to the supplied defaults). */
    private async fail(res: Response, message: string, code: string): Promise<never> {
        const body = (await res.json().catch(() => ({}))) as { error?: { message?: string; code?: string } }
        const err = body?.error || {}
        throw new AnalyserError(err.message || message, err.code || code)
    }

    // ─── /query ───────────────────────────────────────────────────────────────
    async query(repoId: string, question: string, maxBudgetUsd?: number): Promise<QueryResult> {
        const res = await fetch(`${this.base()}/query`, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...this.authHeader() },
            body: JSON.stringify({ repo_id: repoId, question, max_budget_usd: maxBudgetUsd }),
        })
        if (!res.ok) return this.fail(res, `query failed: HTTP ${res.status}`, "query_failed")
        return (await res.json()) as QueryResult
    }

    // ─── /chat (SSE) — return the raw Response so the caller pipes body through ─
    async streamChat(
        repoId: string,
        question: string,
        history?: ChatHistoryMessage[],
        maxBudgetUsd?: number,
        projectId?: string,
        conversationId?: string,
    ): Promise<Response> {
        const res = await fetch(`${this.base()}/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "text/event-stream", ...this.authHeader() },
            // project_id scopes the thinker's "issues" action; conversation_id keys
            // the durable managed-context store; history is the short buffer.
            body: JSON.stringify({
                repo_id: repoId,
                project_id: projectId,
                conversation_id: conversationId,
                question,
                history,
                max_budget_usd: maxBudgetUsd,
            }),
        })
        if (!res.ok || !res.body) return this.fail(res, `chat failed: HTTP ${res.status}`, "chat_failed")
        return res
    }

    // ─── /issues/analyse (sync) ───────────────────────────────────────────────
    async analyseIssue(input: IssueAnalyseInput): Promise<IssueAnalysis> {
        const res = await fetch(`${this.base()}/issues/analyse`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...this.authHeader(),
                ...(input.userId ? { "X-Bobby-User": input.userId } : {}),
            },
            // An omitted effort never reaches the wire (JSON.stringify drops
            // undefined), so the analyser applies its own fallback chain.
            body: JSON.stringify({
                repo_id: input.repoId,
                title: input.title,
                body: input.body,
                labels: input.labels,
                priority: input.priority,
                max_budget_usd: input.maxBudgetUsd,
                effort: input.effort,
            }),
        })
        if (!res.ok) return this.fail(res, `analyse failed: HTTP ${res.status}`, "analyse_failed")
        return (await res.json()) as IssueAnalysis
    }

    // ─── /issues/analyse/run (detached, cancellable) ──────────────────────────
    async startIssueAnalysis(input: IssueAnalyseInput, taskId: string, callback: AnalyserRunCallback): Promise<void> {
        const res = await fetch(`${this.base()}/issues/analyse/run`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...this.authHeader(),
                ...(input.userId ? { "X-Bobby-User": input.userId } : {}),
            },
            body: JSON.stringify({
                repo_id: input.repoId,
                title: input.title,
                body: input.body,
                labels: input.labels,
                priority: input.priority,
                effort: input.effort,
                max_budget_usd: input.maxBudgetUsd,
                task_id: taskId,
                callback,
            }),
        })
        if (!res.ok && res.status !== 202) return this.fail(res, `analyse/run failed: HTTP ${res.status}`, "analyse_run_failed")
    }

    // ─── /issues/analyse/cancel (best-effort) ─────────────────────────────────
    async cancelIssueAnalysis(taskId: string): Promise<void> {
        await fetch(`${this.base()}/issues/analyse/cancel`, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...this.authHeader() },
            body: JSON.stringify({ task_id: taskId }),
        }).catch(() => {})
    }

    // ─── /pr/analyse/run (detached, cancellable) ──────────────────────────────
    async startPRAnalysis(input: PrAnalyseInput, taskId: string, callback: AnalyserRunCallback): Promise<void> {
        const res = await fetch(`${this.base()}/pr/analyse/run`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...this.authHeader(),
                ...(input.userId ? { "X-Bobby-User": input.userId } : {}),
            },
            body: JSON.stringify({
                repo_id: input.repoId,
                project_id: input.projectId,
                number: input.number,
                title: input.title,
                body: input.body,
                base_sha: input.baseSha,
                head_sha: input.headSha,
                files: input.files,
                max_budget_usd: input.maxBudgetUsd,
                task_id: taskId,
                callback,
            }),
        })
        if (!res.ok && res.status !== 202) return this.fail(res, `pr/analyse/run failed: HTTP ${res.status}`, "pr_run_failed")
    }

    // ─── /pr/analyse/cancel (best-effort) ─────────────────────────────────────
    async cancelPRAnalysis(taskId: string): Promise<void> {
        await fetch(`${this.base()}/pr/analyse/cancel`, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...this.authHeader() },
            body: JSON.stringify({ task_id: taskId }),
        }).catch(() => {})
    }

    // ─── /pr/insight/{id}/deep-dive ───────────────────────────────────────────
    async deepDivePRInsight(insightId: string): Promise<DeepDiveResult> {
        const res = await fetch(`${this.base()}/pr/insight/${encodeURIComponent(insightId)}/deep-dive`, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...this.authHeader() },
        })
        if (!res.ok) return this.fail(res, `deep-dive failed: HTTP ${res.status}`, "deep_dive_failed")
        return (await res.json()) as DeepDiveResult
    }

    // ─── /issues/preferences ──────────────────────────────────────────────────
    async getIssuePreferences(repoId: string): Promise<IssuePreferences> {
        const url = new URL(`${this.base()}/issues/preferences`)
        url.searchParams.set("repo_id", repoId)
        const res = await fetch(url.toString(), { method: "GET", headers: { ...this.authHeader() } })
        if (!res.ok) return this.fail(res, `preferences fetch failed: HTTP ${res.status}`, "preferences_failed")
        return (await res.json()) as IssuePreferences
    }

    async setIssuePreferences(repoId: string, effort: AnalyseEffort | ""): Promise<IssuePreferences> {
        const res = await fetch(`${this.base()}/issues/preferences`, {
            method: "PUT",
            headers: { "Content-Type": "application/json", ...this.authHeader() },
            body: JSON.stringify({ repo_id: repoId, effort }),
        })
        if (!res.ok) return this.fail(res, `preferences save failed: HTTP ${res.status}`, "preferences_failed")
        return (await res.json()) as IssuePreferences
    }

    // ─── /issues/compose ──────────────────────────────────────────────────────
    async compose(input: IssueComposeInput): Promise<IssueComposeProposal> {
        const res = await fetch(`${this.base()}/issues/compose`, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...this.authHeader() },
            body: JSON.stringify({ paragraph: input.paragraph, images: input.images ?? [] }),
        })
        if (!res.ok) return this.fail(res, `compose failed: HTTP ${res.status}`, "compose_failed")
        return (await res.json()) as IssueComposeProposal
    }

    // ─── /embeddings ──────────────────────────────────────────────────────────
    async embed(text: string): Promise<EmbedResult> {
        const res = await fetch(`${this.base()}/embeddings`, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...this.authHeader() },
            body: JSON.stringify({ text }),
        })
        if (!res.ok) return this.fail(res, `embed failed: HTTP ${res.status}`, "embed_failed")
        return (await res.json()) as EmbedResult
    }

    // ─── /verify ──────────────────────────────────────────────────────────────
    async verify(input: VerifyInput): Promise<VerifyReport> {
        const body: Record<string, unknown> = { repo_url: input.repoUrl, repo_id: input.repoId }
        if (input.repoRef) body.repo_ref = input.repoRef
        if (input.maxBrokenSamples) body.max_broken_samples = input.maxBrokenSamples
        if (input.userId) body.user_id = input.userId
        if (input.gitToken) body.git_auth = { token: input.gitToken, username: "x-access-token", scheme: "basic" }
        const res = await fetch(`${this.base()}/verify`, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...this.authHeader() },
            body: JSON.stringify(body),
        })
        if (!res.ok) return this.fail(res, `verify failed: HTTP ${res.status}`, "verify_failed")
        return (await res.json()) as VerifyReport
    }

    // ─── /jobs/run (fire-and-forget indexing kickoff, ~50ms) ──────────────────
    async startIndex(input: KickoffJobInput): Promise<KickoffResult> {
        const res = await fetch(`${this.base()}/jobs/run`, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...this.authHeader() },
            body: JSON.stringify(input),
        })
        if (!res.ok && res.status !== 202) return this.fail(res, `kickoff failed: HTTP ${res.status}`, "kickoff_failed")
        return (await res.json()) as KickoffResult
    }

    // ─── /graphs/delete (idempotent) ──────────────────────────────────────────
    async deleteGraph(graphId: string): Promise<void> {
        const res = await fetch(`${this.base()}/graphs/delete`, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...this.authHeader() },
            body: JSON.stringify({ repo_id: graphId }),
        })
        if (!res.ok) return this.fail(res, `delete graph failed: HTTP ${res.status}`, "delete_failed")
    }
}
