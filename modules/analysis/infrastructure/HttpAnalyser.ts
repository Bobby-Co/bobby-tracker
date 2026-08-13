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
    RetrieveInput,
    RetrieveResult,
    NeighboursInput,
    NeighboursResult,
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

    /** Attribution for the Prowl ledger. We authenticate with a SHARED service
     *  token, so without this header the analyser has no way to tell which user
     *  a call belongs to — it falls back to the bearer token, which is not a
     *  uuid and gets dropped from the usage row. */
    private userHeader(userId?: string): Record<string, string> {
        return userId ? { "X-Bobby-User": userId } : {}
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

    // ─── /retrieve — ranked file cards, no synthesis, no source ───────────────
    async retrieve(input: RetrieveInput): Promise<RetrieveResult> {
        const res = await fetch(`${this.base()}/retrieve`, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...this.authHeader(), ...this.userHeader(input.userId) },
            // Omitted keys never reach the wire (JSON.stringify drops undefined),
            // so the analyser applies its own defaults for budget/agents/files.
            // Note the analyser rejects UNKNOWN keys outright — don't send one.
            body: JSON.stringify({
                repo_id: input.repoId,
                query: input.query,
                hints: input.hints,
                max_budget_usd: input.maxBudgetUsd,
                max_agents: input.maxAgents,
                max_files: input.maxFiles,
            }),
        })
        if (!res.ok) return this.fail(res, `retrieve failed: HTTP ${res.status}`, "retrieve_failed")
        const body = (await res.json()) as Partial<RetrieveResult>
        // Normalise: the tools downstream map/slice these unconditionally, and a
        // null array from an older analyser build shouldn't throw at a call site.
        return {
            files: body.files ?? [],
            symbols: body.symbols ?? [],
            notes: body.notes ?? [],
            clusters: body.clusters ?? [],
            stats: body.stats,
        }
    }

    // ─── /neighbours — one graph hop, no model ────────────────────────────────
    async neighbours(input: NeighboursInput): Promise<NeighboursResult> {
        const res = await fetch(`${this.base()}/neighbours`, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...this.authHeader(), ...this.userHeader(input.userId) },
            body: JSON.stringify({
                repo_id: input.repoId,
                node_id: input.nodeId,
                symbol: input.symbol,
                file: input.file,
                edges: input.edges,
                direction: input.direction,
                limit: input.limit,
            }),
        })
        if (!res.ok) return this.fail(res, `neighbours failed: HTTP ${res.status}`, "neighbours_failed")
        const body = (await res.json()) as Partial<NeighboursResult>
        return {
            anchors: body.anchors ?? [],
            neighbours: body.neighbours ?? [],
            notes: body.notes ?? [],
            truncated: body.truncated,
        }
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
            headers: { "Content-Type": "application/json", ...this.authHeader(), ...this.userHeader(input.userId) },
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
            headers: { "Content-Type": "application/json", ...this.authHeader(), ...this.userHeader(input.userId) },
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
            headers: { "Content-Type": "application/json", ...this.authHeader(), ...this.userHeader(input.userId) },
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
