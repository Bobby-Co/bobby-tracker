import { jsonError } from "@/lib/server/http/api"
import { dataClientByProbe } from "@/lib/server/regional"
import { after } from "next/server"
import { createPullRequestAnalysisService, createRunQueue } from "@/modules/analysis"
import type { PrAnalysis } from "@/lib/shared/types"

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
    let result: PrAnalysis | null = null
    try {
        const body = (await request.json()) as {
            task_id?: string
            status?: string
            result?: PrAnalysis | null
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
        const id = taskId
        // See the issue callback: project_id rides along on the probe so the drain
        // can resolve the owning team without a second read.
        let projectId: string | null = null
        const regional = await dataClientByProbe(request, async (db) => {
            const { data } = await db
                .from("pull_request_analyses")
                .select("id, project_id")
                .eq("id", id)
                .maybeSingle<{ id: string; project_id: string }>()
            if (data) projectId = data.project_id
            return !!data
        })
        const origin = new URL(request.url).origin
        await createPullRequestAnalysisService(regional).applyResult(taskId, status, result, origin)

        // A slot just freed — start whatever the cap deferred (0085). After the
        // response, for the same reason as the issue callback.
        if (projectId) {
            const pid: string = projectId
            after(async () => {
                try {
                    await createRunQueue(regional).drainForProject(pid, origin)
                } catch (e) {
                    console.warn("[run-queue] drain after PR callback failed:", (e as Error).message)
                }
            })
        }
    } catch (err) {
        const e = err as { message?: string }
        return jsonError("apply_failed", e?.message ?? "apply failed", 500)
    }
    return Response.json({ ok: true })
}
