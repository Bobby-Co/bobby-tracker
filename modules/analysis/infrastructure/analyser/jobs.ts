// Indexing jobs: /jobs/run (HTTP fire-and-forget) + /graphs/delete, plus the
// legacy WebSocket /jobs path kept for CLI use.

import WebSocket from "ws"
import { ANALYSER_TOKEN, AnalyserError, assertConfigured, authHeader } from "./client"

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
    /** auth.users UUID whose stored GitHub token the analyser worker
     * fetches from tracker.github_tokens to clone private repos. Preferred
     * over git_auth — the token never crosses the wire. */
    user_id?: string
    /** Optional explicit clone credential. Honored over user_id by the
     * analyser; kept only as an escape hatch — normally omit it. */
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

// deleteGraph tears down a repo's knowledge graph on the analyser (FalkorDB +
// on-disk files) by its graph id. Used by the delete-project flow — the graph
// is external to the tracker DB, so nothing cascades to it. Idempotent on the
// analyser side (deleting a never-indexed / already-gone graph is a 200).
export async function deleteGraph(graphId: string): Promise<void> {
    const { http } = assertConfigured()
    const res = await fetch(`${http}/graphs/delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader() },
        body: JSON.stringify({ repo_id: graphId }),
    })
    if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        const err = body?.error || {}
        throw new AnalyserError(err.message || `delete graph failed: HTTP ${res.status}`, err.code || "delete_failed")
    }
}

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

// The analyser doesn't echo repo_id in the done frame, but it does return
// graph_path = `{GraphRoot}/{repoID}/`. Extract the trailing segment so the
// caller can store it for later /query lookups.
function repoIdFromGraphPath(graphPath: unknown): string | null {
    if (typeof graphPath !== "string" || !graphPath) return null
    const trimmed = graphPath.replace(/[\/\\]+$/, "")
    const seg = trimmed.split(/[\/\\]/).pop()
    return seg || null
}
