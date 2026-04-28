import { ask, AnalyserError } from "@/lib/analyser"
import { jsonError, requireUser } from "@/lib/api"
import type { Project, ProjectAnalyser } from "@/lib/supabase/types"

// POST /api/projects/[id]/ask
//
// Free-form Q&A against an indexed graph. Wraps the analyser's
// synchronous /query endpoint (lib/analyser.ts:ask). Single-shot:
// no history is persisted server-side — the client owns the
// conversation log so users can refresh away.
//
// Body: { question: string, max_budget_usd?: number }
//
// 409 needs_indexing — when project_analyser isn't ready (matches
// the suggest route so the UI can prompt the user identically).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { supabase, error } = await requireUser()
    if (error) return error

    let body: Record<string, unknown> = {}
    try { body = await request.json() } catch {}
    const question = typeof body?.question === "string" ? body.question.trim() : ""
    if (!question) return jsonError("bad_request", "question is required", 400)
    if (question.length > 4000) return jsonError("bad_request", "question is too long (4000 char max)", 400)

    const maxBudgetUsd =
        typeof body?.max_budget_usd === "number" && body.max_budget_usd > 0
            ? body.max_budget_usd
            : undefined

    const { data: project, error: pErr } = await supabase
        .from("projects")
        .select("id")
        .eq("id", id)
        .single<Pick<Project, "id">>()
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
            "Enable bobby-analyser and run an index for this project before asking questions.",
            409,
        )
    }

    try {
        const result = await ask(analyser.graph_id, question, maxBudgetUsd)
        return Response.json(result)
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        const code = e instanceof AnalyserError ? e.code : "ask_failed"
        const status = code === "timeout" ? 504 : 502
        return jsonError(code, message, status)
    }
}
