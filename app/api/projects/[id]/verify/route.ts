import { verifyGraph, AnalyserError } from "@/lib/analyser"
import { jsonError, requireUser } from "@/lib/api"
import type { Project, ProjectAnalyser } from "@/lib/supabase/types"

// POST /api/projects/[id]/verify
//
// Synchronous graph-health check. No LLM calls; the analyser server
// clones the repo on demand and validates every note's file:line
// citations + measures last-commit drift. Returns the structured
// VerifyReport for the panel to render.
//
// 409 needs_indexing — mirrors the suggest/ask routes when project_analyser
// isn't ready.
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

    const { data: analyser, error: aErr } = await supabase
        .from("project_analyser")
        .select("*")
        .eq("project_id", id)
        .maybeSingle<ProjectAnalyser>()
    if (aErr) return jsonError("db_error", aErr.message, 500)
    if (!analyser?.enabled || analyser.status !== "ready" || !analyser.graph_id) {
        return jsonError(
            "needs_indexing",
            "Enable bobby-analyser and run an index for this project before verifying.",
            409,
        )
    }

    try {
        const report = await verifyGraph({
            repoUrl: project.repo_url,
            repoId: analyser.graph_id,
            gitToken,
        })
        return Response.json(report)
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        const code = e instanceof AnalyserError ? e.code : "verify_failed"
        return jsonError(code, message, 502)
    }
}
