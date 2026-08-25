import { jsonError } from "@/lib/server/http/api"
import { dataClientByProbe } from "@/lib/server/regional"
import { trace } from "@/lib/server/trace"
import { after } from "next/server"
import { createIssueAnalysisService, createRunQueue } from "@/modules/analysis"
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
        // Which region holds this issue? The analyser stamps X-Bobby-Cell; absent
        // that we probe. `issues` is regional and the task id IS the issue id.
        const id = taskId
        trace("callback.received", { taskId, status, hasResult: !!result })
        // project_id comes back from the probe itself rather than a second read:
        // the drain below needs it to find the owning team, and this query is
        // already being made to locate the region.
        let projectId: string | null = null
        const regional = await dataClientByProbe(request, async (db) => {
            const { data } = await db
                .from("issues")
                .select("id, project_id")
                .eq("id", id)
                .maybeSingle<{ id: string; project_id: string }>()
            if (data) projectId = data.project_id
            return !!data
        })
        const origin = new URL(request.url).origin
        await createIssueAnalysisService(regional).applyResult(taskId, status, result, origin)
        trace("callback.applied", { taskId, status })

        // A slot just freed, so start whatever the concurrency cap deferred (0085).
        // AFTER the response: the analyser is waiting on this callback and has no
        // interest in how long the next team's queue takes to move. `after()` and
        // not a floating promise — a detached promise does not survive on Workers.
        if (projectId) {
            const pid: string = projectId
            after(async () => {
                try {
                    const drained = await createRunQueue(regional).drainForProject(pid, origin)
                    if (drained.started) trace("callback.drained", { taskId, started: drained.started })
                } catch (e) {
                    console.warn("[run-queue] drain after issue callback failed:", (e as Error).message)
                }
            })
        }
    } catch (err) {
        const e = err as { message?: string }
        return jsonError("apply_failed", e?.message ?? "apply failed", 500)
    }
    return Response.json({ ok: true })
}
