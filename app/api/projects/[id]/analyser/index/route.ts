import { runJob, AnalyserError } from "@/lib/analyser"
import { jsonError, requireUser } from "@/lib/api"
import type { Project, ProjectAnalyser } from "@/lib/supabase/types"

// POST /api/projects/[id]/analyser/index
//
// Returns an NDJSON stream of events while the analyser runs:
//
//   {"event":"accepted","job_id":"…"}
//   {"event":"progress","kind":"clone_start", …}
//   {"event":"log","stream":"stderr","data":"…"}
//   {"event":"progress","kind":"module_start","slug":"go-internal-auth", …}
//   {"event":"done","graph_id":"abc123","cost_usd":0.12, …}
//
// Or on failure:
//
//   {"event":"error","code":"ws_error","message":"…"}
//
// The browser reads the body via fetch().body.getReader() and updates the
// AnalyserPanel live. Status is also written back to project_analyser at
// start (`indexing`), success (`ready`), and failure (`failed`) so other
// clients see the same state on a refresh.
//
// Run on `next start` on a Node host — this stream stays open for the
// duration of the indexing job (potentially several minutes).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { supabase, error } = await requireUser()
    if (error) return error

    let body: Record<string, unknown> = {}
    try { body = await request.json() } catch {}
    const gitToken = typeof body?.git_token === "string" && body.git_token ? body.git_token : undefined

    const { data: project, error: pErr } = await supabase
        .from("projects")
        .select("*")
        .eq("id", id)
        .single<Project>()
    if (pErr || !project) return jsonError("not_found", "project not found", 404)

    const { error: upErr } = await supabase
        .from("project_analyser")
        .upsert(
            { project_id: id, enabled: true, status: "indexing", last_error: null },
            { onConflict: "project_id" },
        )
    if (upErr) return jsonError("db_error", upErr.message, 500)

    const stream = new ReadableStream({
        async start(controller) {
            const enc = new TextEncoder()
            const write = (frame: Record<string, unknown>) => {
                try {
                    controller.enqueue(enc.encode(JSON.stringify(frame) + "\n"))
                } catch {
                    // controller closed (client disconnected) — swallow.
                }
            }

            // Heartbeat every 15s so reverse proxies don't think the
            // connection has stalled during quiet stretches.
            const heartbeat = setInterval(() => write({ event: "heartbeat", ts: Date.now() }), 15_000)

            try {
                const result = await runJob(
                    {
                        repo_url: project.repo_url,
                        effort: "medium",
                        git_auth: gitToken
                            ? { token: gitToken, username: "x-access-token", scheme: "basic" }
                            : undefined,
                    },
                    {
                        onAccepted: (jobId) => write({ event: "accepted", job_id: jobId }),
                        onProgress: (p) => write({ event: "progress", ...p }),
                        // onLog intentionally omitted — the analyser no longer
                        // emits log frames, and the UI never rendered them.
                    },
                )

                const { data: row } = await supabase
                    .from("project_analyser")
                    .upsert(
                        {
                            project_id: id,
                            enabled: true,
                            status: "ready",
                            graph_id: result.repo_id || null,
                            last_indexed_at: new Date().toISOString(),
                            last_indexed_sha: result.head_sha || null,
                            last_index_cost_usd: result.cost_usd || 0,
                            last_error: null,
                        },
                        { onConflict: "project_id" },
                    )
                    .select("*")
                    .single<ProjectAnalyser>()

                write({ event: "done", result, analyser: row })
            } catch (e) {
                const message = e instanceof Error ? e.message : String(e)
                const code = e instanceof AnalyserError ? e.code : "unknown"
                await supabase
                    .from("project_analyser")
                    .upsert(
                        { project_id: id, enabled: true, status: "failed", last_error: message },
                        { onConflict: "project_id" },
                    )
                write({ event: "error", code, message })
            } finally {
                clearInterval(heartbeat)
                try { controller.close() } catch {}
            }
        },
    })

    return new Response(stream, {
        headers: {
            "Content-Type":      "application/x-ndjson; charset=utf-8",
            "Cache-Control":     "no-store",
            "X-Content-Type-Options": "nosniff",
            // Tell intermediaries (Caddy) not to buffer.
            "X-Accel-Buffering": "no",
        },
    })
}
