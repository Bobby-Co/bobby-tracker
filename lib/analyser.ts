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

// ─── /jobs (WebSocket) ──────────────────────────────────────────────────────

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
