import { jsonError } from "@/lib/server/http/api"
import { createIssueAnalysisService } from "@/modules/analysis"
import type { IssueAnalysis } from "@/modules/analysis"

export const dynamic = "force-dynamic"

// POST /api/internal/analysis-result — the analyser's callback for a detached
// /issues/analyse/run task. Server-to-server, authenticated with the shared
// BOBBY_ANALYSER_TOKEN (same secret as app/api/relay/resolve). Edits the
// issue's placeholder GitHub comment in place with the terminal result.
export async function POST(request: Request) {
    const expected = process.env.BOBBY_ANALYSER_TOKEN
    if (!expected) return jsonError("not_configured", "analysis callback is not configured", 503)

    const auth = request.headers.get("authorization") ?? ""
    const presented = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : ""
    if (presented !== expected) return jsonError("unauthorized", "bad analyser token", 401)

    let taskId: string | undefined
    let status: "done" | "failed" | "cancelled" | undefined
    let result: IssueAnalysis | null = null
    try {
        const body = (await request.json()) as {
            task_id?: string
            status?: string
            result?: IssueAnalysis | null
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
        await createIssueAnalysisService().applyResult(taskId, status, result, new URL(request.url).origin)
    } catch (err) {
        const e = err as { message?: string }
        return jsonError("apply_failed", e?.message ?? "apply failed", 500)
    }
    return Response.json({ ok: true })
}
