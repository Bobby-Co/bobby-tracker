import { AnalyserError, getAnalyser } from "@/modules/analysis"
import { jsonError, requireProjectAccess } from "@/lib/server/http/api"
import type { Project } from "@/lib/shared/types"

// POST /api/projects/[id]/pr-insight/deep-dive
//
// Materialises a PR session-insight into a seeded chat conversation (analyser
// ADR-0055) and returns the conversation_id. The UI then opens the Mind chat at
// /projects/[id]/mind?c=<conversation_id>, and the seeded PR context (top files
// + why, findings) loads on the first turn — no retrieval re-run.
//
// Body: { insight_id: string }
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { supabase, error } = await requireProjectAccess(id)
    if (error) return error

    let body: Record<string, unknown> = {}
    try {
        body = await request.json()
    } catch {}
    const insightId = typeof body?.insight_id === "string" ? body.insight_id.trim() : ""
    if (!insightId) return jsonError("bad_request", "insight_id is required", 400)

    // Ownership: the caller must be able to see this project (RLS scopes the row).
    const { data: project, error: pErr } = await supabase
        .from("projects")
        .select("id")
        .eq("id", id)
        .single<Pick<Project, "id">>()
    if (pErr || !project) return jsonError("not_found", "project not found", 404)

    try {
        const { conversation_id, pr_number, pr_title } = await getAnalyser().deepDivePRInsight(insightId)
        if (!conversation_id) return jsonError("deep_dive_failed", "no conversation returned", 502)
        return Response.json({ conversation_id, pr_number, pr_title })
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        const code = e instanceof AnalyserError ? e.code : "deep_dive_failed"
        return jsonError(code, message, 502)
    }
}
