import { jsonError, requireUser } from "@/lib/api"
import { ISSUE_PRIORITIES, ISSUE_STATUSES } from "@/lib/supabase/types"
import type { Issue, IssuePriority, IssueStatus } from "@/lib/supabase/types"

export async function POST(request: Request) {
    const { supabase, user, error } = await requireUser()
    if (error) return error

    let body: Record<string, unknown>
    try { body = await request.json() } catch { return jsonError("bad_request", "invalid JSON", 400) }

    const project_id = String(body?.project_id ?? "")
    const title = String(body?.title ?? "").trim()
    if (!project_id) return jsonError("bad_request", "project_id required", 400)
    if (!title) return jsonError("bad_request", "title required", 400)

    const rawStatus = typeof body?.status === "string" ? body.status : ""
    const rawPriority = typeof body?.priority === "string" ? body.priority : ""
    const status: IssueStatus = (ISSUE_STATUSES as readonly string[]).includes(rawStatus)
        ? (rawStatus as IssueStatus)
        : "open"
    const priority: IssuePriority = (ISSUE_PRIORITIES as readonly string[]).includes(rawPriority)
        ? (rawPriority as IssuePriority)
        : "medium"
    const labels = Array.isArray(body?.labels)
        ? body.labels.filter((l: unknown): l is string => typeof l === "string")
        : []
    const issueBody = typeof body?.body === "string" ? body.body : ""

    const { data: issue, error: dbErr } = await supabase
        .from("issues")
        .insert({
            project_id,
            user_id: user.id,
            title,
            body: issueBody,
            status,
            priority,
            labels,
        })
        .select("*")
        .single<Issue>()
    if (dbErr) return jsonError("db_error", dbErr.message, 500)
    return Response.json({ issue })
}
