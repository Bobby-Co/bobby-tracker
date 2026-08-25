import { AnalyserError, getAnalyser } from "@/modules/analysis"
import { ApiContext, jsonError } from "@/lib/server/http/api"
import { tryOrNull } from "@/lib/shared/kernel"

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
    const { ctx, teamId, error } = await new ApiContext().requireProjectAccess(id)
    if (error) return error

    // Hard gate: a paused team may read everything and run nothing (0076). Sits
    // after the access guard because a pause is a billing state, not a permission
    // — the 402 tells the client to offer resume/plan, not sign-in.
    const spendErr = await new ApiContext().requireSpend(ctx, teamId)
    if (spendErr) return spendErr

    let body: Record<string, unknown> = {}
    try {
        body = await request.json()
    } catch {}
    const insightId = typeof body?.insight_id === "string" ? body.insight_id.trim() : ""
    if (!insightId) return jsonError("bad_request", "insight_id is required", 400)

    // Ownership: the caller must be able to see this project (RLS scopes the row).
    const pid = await tryOrNull(() => ctx.projects.findId(id))
    if (!pid) return jsonError("not_found", "project not found", 404)

    const cell = await ctx.projects.findCell(id)
    if (!cell) return jsonError("placement_unavailable", "This project's data location is unavailable.", 503)

    try {
        const { conversation_id, pr_number, pr_title } = await getAnalyser(cell).deepDivePRInsight(insightId)
        if (!conversation_id) return jsonError("deep_dive_failed", "no conversation returned", 502)
        return Response.json({ conversation_id, pr_number, pr_title })
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        const code = e instanceof AnalyserError ? e.code : "deep_dive_failed"
        return jsonError(code, message, 502)
    }
}
