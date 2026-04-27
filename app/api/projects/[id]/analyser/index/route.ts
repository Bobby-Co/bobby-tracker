import { kickoffJob, AnalyserError } from "@/lib/analyser"
import { jsonError, requireUser } from "@/lib/api"
import type { AnalyserProgress, Project } from "@/lib/supabase/types"

// POST /api/projects/[id]/analyser/index
//
// Netlify-safe kickoff: returns within ~100ms. The analyser runs the
// indexing in its own detached goroutine and PATCHes progress + final
// state directly to tracker.project_analyser via PostgREST. This
// route just:
//
//   1. Auth + load project
//   2. Mark status='indexing' so the UI flips immediately
//   3. POST to analyser /jobs/run with the Supabase config
//   4. Return 202
//
// No long-lived stream, no background promises that need to outlive
// the function — works on Netlify, Vercel, Lambda, anywhere.
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

    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
        return jsonError(
            "config_missing",
            "Tracker is missing SUPABASE_SERVICE_ROLE_KEY env var (the analyser needs it to write progress back to Supabase).",
            500,
        )
    }
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
        return jsonError("config_missing", "NEXT_PUBLIC_SUPABASE_URL is not set", 500)
    }

    // Flip the UI to "Indexing…" right away. Realtime delivers this
    // to subscribers instantly; the analyser will overwrite progress
    // updates as the job runs.
    const initial: AnalyserProgress = { phase: "Starting…", started_at: new Date().toISOString() }
    const { error: upErr } = await supabase
        .from("project_analyser")
        .upsert(
            {
                project_id: id,
                enabled: true,
                status: "indexing",
                last_error: null,
                progress: initial,
            },
            { onConflict: "project_id" },
        )
    if (upErr) return jsonError("db_error", upErr.message, 500)

    try {
        const result = await kickoffJob({
            repo_url: project.repo_url,
            effort: "medium",
            git_auth: gitToken
                ? { token: gitToken, username: "x-access-token", scheme: "basic" }
                : undefined,
            supabase_progress: {
                url: process.env.NEXT_PUBLIC_SUPABASE_URL,
                service_role_key: process.env.SUPABASE_SERVICE_ROLE_KEY,
                schema: "tracker",
                table: "project_analyser",
                key_column: "project_id",
                key_value: id,
            },
        })
        return Response.json(
            { status: "accepted", job_id: result.job_id, project_id: id },
            { status: 202 },
        )
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        const code = e instanceof AnalyserError ? e.code : "kickoff_failed"
        // Roll back the optimistic 'indexing' upsert so the UI doesn't
        // get stuck at "Starting…" if the analyser was unreachable.
        await supabase
            .from("project_analyser")
            .upsert(
                { project_id: id, enabled: true, status: "failed", last_error: message, progress: {} },
                { onConflict: "project_id" },
            )
        return jsonError(code, message, 502)
    }
}
