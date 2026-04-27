import { runJob, AnalyserError } from "@/lib/analyser"
import { jsonError, requireUser } from "@/lib/api"
import type { Project, ProjectAnalyser } from "@/lib/supabase/types"

// POST /api/projects/[id]/analyser/index
//
// Synchronously kicks off an analyser /jobs run, holding the WebSocket open
// until `done` (or error). Marks the row `indexing` first, then `ready` /
// `failed` on completion. Caller (browser) should expect to wait — this can
// take several minutes for a large repo. Run the tracker via `next start`
// on a host without short request timeouts; do NOT deploy this route to a
// platform that kills long requests (Vercel functions, Lambda).
//
// Phase 3 follow-up: queue the work and return 202 immediately, with a
// background worker driving the WS.
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

    // Mark as indexing.
    const { error: upErr } = await supabase
        .from("project_analyser")
        .upsert(
            { project_id: id, enabled: true, status: "indexing", last_error: null },
            { onConflict: "project_id" },
        )
    if (upErr) return jsonError("db_error", upErr.message, 500)

    try {
        const result = await runJob({
            repo_url: project.repo_url,
            effort: "medium",
            git_auth: gitToken ? { token: gitToken, username: "x-access-token", scheme: "basic" } : undefined,
        })
        const { data: row, error: dbErr } = await supabase
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
        if (dbErr) return jsonError("db_error", dbErr.message, 500)
        return Response.json({ analyser: row, result })
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        const code = e instanceof AnalyserError ? e.code : "unknown"
        await supabase
            .from("project_analyser")
            .upsert(
                { project_id: id, enabled: true, status: "failed", last_error: msg },
                { onConflict: "project_id" },
            )
        return jsonError(code, msg, 502)
    }
}
