import { jsonError } from "@/lib/platform/http/api"
import { applyPRResult } from "@/modules/analysis"
import type { PRAnalysis } from "@/lib/supabase/types"

export const dynamic = "force-dynamic"

// POST /api/internal/pr-analysis-result — the analyser's callback for a detached
// /pr/analyse/run task. Server-to-server, authenticated with the shared
// BOBBY_ANALYSER_TOKEN. Edits the PR's placeholder comment in place with the
// terminal review.
export async function POST(request: Request) {
    const expected = process.env.BOBBY_ANALYSER_TOKEN
    if (!expected) return jsonError("not_configured", "pr analysis callback is not configured", 503)

    const auth = request.headers.get("authorization") ?? ""
    const presented = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : ""
    if (presented !== expected) return jsonError("unauthorized", "bad analyser token", 401)

    let taskId: string | undefined
    let status: "done" | "failed" | "cancelled" | undefined
    let result: PRAnalysis | null = null
    try {
        const body = (await request.json()) as {
            task_id?: string
            status?: string
            result?: PRAnalysis | null
        }
        taskId = body.task_id
        if (body.status === "done" || body.status === "failed" || body.status === "cancelled") {
            status = body.status
        }
        result = body.result ?? null
    } catch {
        return jsonError("bad_request", "invalid json body", 400)
    }
    if (!taskId || !status) return jsonError("bad_request", "task_id and a valid status are required", 400)

    try {
        await applyPRResult(taskId, status, result, new URL(request.url).origin)
    } catch (err) {
        const e = err as { message?: string }
        return jsonError("apply_failed", e?.message ?? "apply failed", 500)
    }
    return Response.json({ ok: true })
}
