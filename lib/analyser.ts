// Server-side client for the bobby-analyser microservice.
//
// The hosted analyser exposes:
//   - WS    /jobs    — submit one analysis job per connection (used by runJob)
//   - POST  /query   — ask a question against an indexed graph (used by ask)
//   - GET   /healthz
//
// Configured by env: BOBBY_ANALYSER_URL (e.g. https://analyser.example.com)
// and BOBBY_ANALYSER_TOKEN. Token is server-only — never ship it to the
// browser. See bobby-analyser/docs/subsystems/server.md for protocol details.

import WebSocket from "ws"

const ANALYSER_URL = process.env.BOBBY_ANALYSER_URL || ""
const ANALYSER_TOKEN = process.env.BOBBY_ANALYSER_TOKEN || ""

export class AnalyserError extends Error {
    constructor(message: string, public readonly code: string = "analyser_error") {
        super(message)
    }
}

function assertConfigured(): { http: string; ws: string } {
    if (!ANALYSER_URL) {
        throw new AnalyserError("BOBBY_ANALYSER_URL is not set", "not_configured")
    }
    const http = ANALYSER_URL.replace(/\/+$/, "")
    const ws = http.replace(/^http/, "ws")
    return { http, ws }
}

function authHeader(): Record<string, string> {
    return ANALYSER_TOKEN ? { Authorization: `Bearer ${ANALYSER_TOKEN}` } : {}
}

// ─── /query ─────────────────────────────────────────────────────────────────

export interface QueryResult {
    markdown: string
    graph_cites?: string[]
    code_cites?: { file: string; line?: number }[]
    confidence?: string
    stop_reason?: string
    cost_usd: number
    duration_ms: number
    tool_calls?: number
}

export async function ask(repoId: string, question: string, maxBudgetUsd?: number): Promise<QueryResult> {
    const { http } = assertConfigured()
    const res = await fetch(`${http}/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader() },
        body: JSON.stringify({ repo_id: repoId, question, max_budget_usd: maxBudgetUsd }),
    })
    if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        const err = body?.error || {}
        throw new AnalyserError(err.message || `query failed: HTTP ${res.status}`, err.code || "query_failed")
    }
    return (await res.json()) as QueryResult
}

// ─── /issues/analyse (structured) ──────────────────────────────────────────

export interface IssueFinding {
    file:        string
    line?:       number
    symbol?:     string
    reason:      string
    confidence?: "high" | "medium" | "low" | string
}

export interface IssueAnalysis {
    summary:      string
    suggestions:  IssueFinding[]
    confidence?:  "high" | "medium" | "low" | string
    graph_cites?: string[]
    stop_reason?: string
    cost_usd:     number
    duration_ms:  number
    tool_calls?:  number
    markdown?:    string
}

export interface IssueAnalyseInput {
    repoId:        string
    title:         string
    body?:         string
    labels?:       string[]
    priority?:     string
    maxBudgetUsd?: number
}

export async function analyseIssue(input: IssueAnalyseInput): Promise<IssueAnalysis> {
    const { http } = assertConfigured()
    const res = await fetch(`${http}/issues/analyse`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader() },
        body: JSON.stringify({
            repo_id: input.repoId,
            title:   input.title,
            body:    input.body,
            labels:  input.labels,
            priority: input.priority,
            max_budget_usd: input.maxBudgetUsd,
        }),
    })
    if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        const err = body?.error || {}
        throw new AnalyserError(err.message || `analyse failed: HTTP ${res.status}`, err.code || "analyse_failed")
    }
    return (await res.json()) as IssueAnalysis
}

// ─── /issues/compose (AI draft from paragraph + images) ───────────────────

export type IssueComposePriority = "low" | "medium" | "high" | "urgent"
export type IssueComposeConfidence = "low" | "medium" | "high"
/** Architecture boundary the issue sits at. The analyser chooses one
 *  value from this controlled vocabulary; matched against the project
 *  layer-tag pool by find_similar_projects. */
export type IssueComposeLayer =
    | "frontend" | "backend" | "api"
    | "database" | "infra" | "mobile" | "shared"
export type IssueComposeAction =
    | "bug" | "feature" | "refactor" | "performance" | "security" | "test" | "docs"
export type IssueComposeScope = "local" | "cross-repo" | "system-wide"

export interface IssueComposeProposal {
    title:      string
    body:       string
    priority:   IssueComposePriority
    labels:     string[]
    confidence: IssueComposeConfidence
    /** Optional 1–2 sentence domain/surface restatement produced by
     *  the analyser solely for routing — meant to be embedded and
     *  compared against project-summary facets. Older analyser
     *  builds may omit this; callers should fall back to
     *  issueEmbeddingText(proposal) when it's missing or empty. */
    routing_summary?: string
    /** Architecture boundary. Embedded and compared against the
     *  project's layer-tag pool. Optional only because older analyser
     *  builds omit it; new builds always set a value. */
    layer?: IssueComposeLayer | string
    /** Hierarchical "domain/subdomain" tags (e.g. "auth/login",
     *  "billing/invoice"). 1-3 entries. Joined for the feature
     *  embedding query. */
    features?: string[]
    /** What kind of work this is. Not currently used in routing
     *  weights but surfaced for UI display + future filters. */
    action?: IssueComposeAction | string
    /** How wide the impact is. Hint for the routing UI to pre-select
     *  multiple targets when scope = "cross-repo". */
    scope?: IssueComposeScope | string
    model:      string
    duration_ms: number
    usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
}

export interface IssueComposeInput {
    paragraph: string
    /** Each image must already be a `data:image/...;base64,…` URI
     *  (compress on the client first via lib/image-compress.ts). */
    images?: string[]
}

export async function composeIssue(input: IssueComposeInput): Promise<IssueComposeProposal> {
    const { http } = assertConfigured()
    const res = await fetch(`${http}/issues/compose`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader() },
        body: JSON.stringify({ paragraph: input.paragraph, images: input.images ?? [] }),
    })
    if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        const err = body?.error || {}
        throw new AnalyserError(err.message || `compose failed: HTTP ${res.status}`, err.code || "compose_failed")
    }
    return (await res.json()) as IssueComposeProposal
}

// ─── /embeddings ──────────────────────────────────────────────────────────

export interface EmbedResult {
    vector:     number[]
    dimensions: number
    model:      string
    usage: { prompt_tokens: number; total_tokens: number }
}

export async function embedText(text: string): Promise<EmbedResult> {
    const { http } = assertConfigured()
    const res = await fetch(`${http}/embeddings`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader() },
        body: JSON.stringify({ text }),
    })
    if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        const err = body?.error || {}
        throw new AnalyserError(err.message || `embed failed: HTTP ${res.status}`, err.code || "embed_failed")
    }
    return (await res.json()) as EmbedResult
}

// Compose the text we feed to the embedder. We concatenate title +
// body so similarity reflects what the issue is *about*, not just
// title overlap. Truncated to a generous slice to stay under the
// embedding model's input window without a tokenizer.
export function issueEmbeddingText(issue: { title: string; body: string }): string {
    const body = (issue.body ?? "").trim()
    const title = (issue.title ?? "").trim()
    return `${title}\n\n${body}`.slice(0, 7500)
}

// Pick the text we should embed for cross-project *routing*. The
// analyser produces a short domain/surface restatement specifically
// for this — using it makes routing scores comparable to the project
// facet vectors instead of being dominated by user prose. Older
// analyser builds may omit it, in which case we fall back to the
// title+body blob used for issue-to-issue similarity.
export function routingEmbeddingText(proposal: IssueComposeProposal): string {
    const summary = (proposal.routing_summary ?? "").trim()
    if (summary) return summary.slice(0, 7500)
    return issueEmbeddingText({ title: proposal.title, body: proposal.body })
}

// Text we embed for the layer dimension of cross-project routing. The
// analyser's `layer` is a controlled vocab string ("frontend", etc.);
// when missing we use a stable empty-fallback that still produces a
// usable vector — it just won't match anything specific in the
// project's layer pool.
export function layerEmbeddingText(proposal: IssueComposeProposal): string {
    const layer = (proposal.layer ?? "").toString().trim()
    return layer || "unspecified"
}

// Text we embed for the feature dimension. The analyser emits 1-3
// hierarchical "domain/subdomain" tags; we join with newlines so the
// embedding model treats each as a distinct phrase. Falls back to the
// routing summary when the analyser didn't tag features — better than
// embedding empty text.
export function featureEmbeddingText(proposal: IssueComposeProposal): string {
    const tags = (proposal.features ?? [])
        .map((t) => (t ?? "").toString().trim())
        .filter(Boolean)
    if (tags.length > 0) return tags.join("\n")
    const summary = (proposal.routing_summary ?? "").trim()
    if (summary) return summary.slice(0, 1000)
    return "unspecified"
}

// ─── /verify (HTTP, request/response) ──────────────────────────────────────

export interface VerifyBrokenCite {
    note_path: string
    file: string
    line?: number
    reason: "file_not_found" | "line_out_of_range" | "empty_file" | string
}

export interface VerifyStaleNote {
    path: string
    last_commit: string
    /** -1 means the SHA isn't reachable from HEAD in this clone (treat as unknown). */
    commits_behind: number
}

export interface VerifyContentStaleNote {
    path: string
    last_commit: string
    /** Files this note cites that have been modified since note.last_commit. */
    changed_cited_files: string[]
}

export interface VerifyReport {
    generated_at: string
    head_sha: string
    notes: number
    notes_by_kind: Record<string, number>

    citations_total: number
    citations_resolved: number
    citations_broken?: VerifyBrokenCite[]
    /** 0..1; 1.0 when there are zero citations (vacuously perfect). */
    hit_rate: number

    drift_median: number
    drift_max: number
    drift_buckets: Record<string, number>
    stalest_notes?: VerifyStaleNote[]

    /** Indexed source files the bootstrap knew about. */
    indexed_files: number
    /** Indexed files cited by at least one note. */
    covered_files: number
    /** Sample of indexed files no note cites; total is uncovered_total. */
    uncovered_files?: string[]
    uncovered_total: number
    /** 0..1 covered/indexed; 1.0 when the bootstrap left no indexed-file map. */
    coverage_rate: number

    /** Notes whose cited files moved underneath them (sharper than drift). */
    content_stale_notes?: VerifyContentStaleNote[]
    content_stale_total: number

    /** 0..1 composite of hit_rate (45%), drift-decay (20%), coverage (20%), content-stale penalty (15%). */
    overall_health: number
}

export interface VerifyInput {
    repoUrl: string
    repoId: string
    repoRef?: string
    gitToken?: string
    /** Cap on the per-note BrokenCitations sample. Total counts are exact regardless. */
    maxBrokenSamples?: number
}

/** verifyGraph runs a no-LLM graph health check on the analyser server.
 * It clones the repo (server-side, ephemeral), validates every cluster
 * note's `file:line` citations against live source, and measures drift
 * (commits behind HEAD per note). Synchronous; typically 5-30s. */
export async function verifyGraph(input: VerifyInput): Promise<VerifyReport> {
    const { http } = assertConfigured()
    const body: Record<string, unknown> = {
        repo_url: input.repoUrl,
        repo_id: input.repoId,
    }
    if (input.repoRef) body.repo_ref = input.repoRef
    if (input.maxBrokenSamples) body.max_broken_samples = input.maxBrokenSamples
    if (input.gitToken) {
        body.git_auth = { token: input.gitToken, username: "x-access-token", scheme: "basic" }
    }
    const res = await fetch(`${http}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader() },
        body: JSON.stringify(body),
    })
    if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: { message?: string; code?: string } }
        const e = err?.error || {}
        throw new AnalyserError(e.message || `verify failed: HTTP ${res.status}`, e.code || "verify_failed")
    }
    return (await res.json()) as VerifyReport
}

// ─── /jobs/run (HTTP fire-and-forget) ───────────────────────────────────────

export interface SupabaseProgressTarget {
    /** Row key — the only piece the tracker sends. Connection details
     * (URL, service-role JWT, schema, table, key column) are
     * configured on the analyser server's environment so secrets stay
     * off the wire. */
    key_value: string
}

export interface KickoffJobInput {
    /** Selects the analyser pipeline. Empty defaults to "bootstrap"
     * server-side. Use "incremental" to run a delta against an existing
     * graph (the project must have been bootstrapped successfully on
     * this server before — otherwise the analyser fails fast with a
     * "bootstrap first?" error). */
    job_type?: "bootstrap" | "incremental"
    repo_url: string
    repo_ref?: string
    repo_id?: string
    effort?: "low" | "medium" | "high"
    only_lang?: string[]
    max_budget_usd?: number
    concurrency?: number
    git_auth?: { token: string; username?: string; scheme?: "basic" | "bearer" }
    supabase_progress: SupabaseProgressTarget
}

export interface KickoffResult {
    job_id: string
    status: "accepted"
    runner: string
    version: string
    hostname?: string
}

// kickoffJob POSTs the job spec to /jobs/run on the analyser. The
// analyser runs the job in a detached goroutine and PATCHes progress
// directly to Supabase (using the supplied service-role JWT). This
// HTTP call returns within ~50ms — Netlify / Vercel function safe.
export async function kickoffJob(input: KickoffJobInput): Promise<KickoffResult> {
    const { http } = assertConfigured()
    const res = await fetch(`${http}/jobs/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader() },
        body: JSON.stringify(input),
    })
    if (!res.ok && res.status !== 202) {
        const body = await res.json().catch(() => ({}))
        const err = body?.error || {}
        throw new AnalyserError(err.message || `kickoff failed: HTTP ${res.status}`, err.code || "kickoff_failed")
    }
    return (await res.json()) as KickoffResult
}

// ─── /jobs (WebSocket, kept for CLI use) ────────────────────────────────────

export interface JobSpec {
    repo_url: string
    repo_ref?: string
    repo_id?: string
    effort?: "low" | "medium" | "high"
    only_lang?: string[]
    max_budget_usd?: number
    concurrency?: number
    git_auth?: { token: string; username?: string; scheme?: "basic" | "bearer" }
}

export interface JobResult {
    job_id: string
    repo_id: string
    head_sha: string
    cost_usd: number
    duration_ms: number
    graph_path?: string
    phase2_completed?: number
    phase2_failed?: number
    stop_reason?: string
}

export interface JobProgress {
    kind: string
    index?: number
    total?: number
    slug?: string
    language?: string
    message?: string
    tool_name?: string
    cost_usd?: number
    cumulative_usd?: number
    elapsed_ms?: number
    error?: string
}

export interface JobLog {
    stream: "stdout" | "stderr"
    data: string
}

export interface RunJobHandlers {
    onAccepted?: (jobId: string) => void
    onProgress?: (p: JobProgress) => void
    onLog?:      (l: JobLog) => void
}

// runJob opens the WebSocket, fires `start`, and resolves when the analyser
// emits `done` (or rejects on `error`). The handlers fire for every frame
// of the corresponding kind so callers can stream updates somewhere (HTTP
// response body, DB row, SSE, etc.).
//
// Note: this holds the WS open for the entire indexing run, which can take
// minutes for a large repo. Run it from a long-lived process (e.g. `next
// start` on a node host) — it will not survive a Vercel function timeout.
export function runJob(spec: JobSpec, handlers?: RunJobHandlers, opts?: { timeoutMs?: number }): Promise<JobResult> {
    const { ws } = assertConfigured()
    const timeoutMs = opts?.timeoutMs ?? 15 * 60_000

    return new Promise((resolve, reject) => {
        const url = new URL(`${ws}/jobs`)
        if (ANALYSER_TOKEN) url.searchParams.set("token", ANALYSER_TOKEN)
        const sock = new WebSocket(url.toString(), { headers: authHeader() })

        let jobId = ""
        let settled = false
        const timer = setTimeout(() => {
            if (settled) return
            settled = true
            try { sock.close(1000) } catch {}
            reject(new AnalyserError("analyser job timed out", "timeout"))
        }, timeoutMs)

        function settle(err: Error | null, val?: JobResult) {
            if (settled) return
            settled = true
            clearTimeout(timer)
            try { sock.close(1000) } catch {}
            if (err) reject(err)
            else resolve(val!)
        }

        sock.on("open", () => {
            sock.send(JSON.stringify({ type: "start", job: spec }))
        })
        sock.on("message", (raw) => {
            let msg: ServerFrame
            try { msg = JSON.parse(raw.toString()) as ServerFrame } catch { return }
            switch (msg.type) {
                case "accepted":
                    jobId = msg.job_id || ""
                    handlers?.onAccepted?.(jobId)
                    break
                case "progress":
                    if (msg.progress) handlers?.onProgress?.(msg.progress)
                    break
                case "log":
                    if (msg.log) handlers?.onLog?.(msg.log)
                    break
                case "done": {
                    const d = msg.done || {} as DoneBody
                    settle(null, {
                        job_id: jobId,
                        repo_id: spec.repo_id || repoIdFromGraphPath(d.graph_path) || "",
                        head_sha: d.head_sha || "",
                        cost_usd: d.cost_usd ?? 0,
                        duration_ms: d.duration_ms ?? 0,
                        graph_path: d.graph_path,
                        phase2_completed: d.phase2_completed,
                        phase2_failed: d.phase2_failed,
                        stop_reason: d.stop_reason,
                    })
                    break
                }
                case "error": {
                    const e = msg.error || { message: "analyser job failed", code: "job_failed" }
                    settle(new AnalyserError(e.message || "analyser job failed", e.code || "job_failed"))
                    break
                }
            }
        })
        sock.on("error", (err: Error) => settle(new AnalyserError(err.message, "ws_error")))
        sock.on("close", (code, reason) => {
            if (!settled) settle(new AnalyserError(`ws closed early (${code}): ${reason}`, "ws_closed"))
        })
    })
}

interface DoneBody {
    head_sha?: string
    cost_usd?: number
    duration_ms?: number
    graph_path?: string
    phase2_completed?: number
    phase2_failed?: number
    stop_reason?: string
}

interface ServerFrame {
    type: "accepted" | "progress" | "log" | "done" | "error" | "pong"
    job_id?: string
    progress?: JobProgress
    log?:      JobLog
    done?:     DoneBody
    error?:    { code?: string; message?: string }
}

// The analyser doesn't echo repo_id in the done frame, but it does return
// graph_path = `{GraphRoot}/{repoID}/`. Extract the trailing segment so the
// caller can store it for later /query lookups.
function repoIdFromGraphPath(graphPath: unknown): string | null {
    if (typeof graphPath !== "string" || !graphPath) return null
    const trimmed = graphPath.replace(/[\/\\]+$/, "")
    const seg = trimmed.split(/[\/\\]/).pop()
    return seg || null
}
