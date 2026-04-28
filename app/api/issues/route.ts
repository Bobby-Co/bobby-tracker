import { jsonError, requireUser } from "@/lib/api"
import { ISSUE_PRIORITIES, ISSUE_STATUSES } from "@/lib/supabase/types"
import type { Issue, IssuePriority, IssueStatus, ProjectAnalyser } from "@/lib/supabase/types"

export async function POST(request: Request) {
    const { supabase, user, error } = await requireUser()
    if (error) return error

    let body: Record<string, unknown>
    try { body = await request.json() } catch { return jsonError("bad_request", "invalid JSON", 400) }

    const project_id = String(body?.project_id ?? "")
    const title = String(body?.title ?? "").trim()
    if (!project_id) return jsonError("bad_request", "project_id required", 400)
    if (!title) return jsonError("bad_request", "title required", 400)

    // Issues without a knowledge graph are low-value (no suggestions,
    // no Ask citations). Block creation until the project has been
    // bootstrapped at least once. The UI mirrors this with a banner +
    // disabled "New issue" button on the issues page; this is the
    // server-side enforcement so direct API calls can't bypass it.
    const { data: analyser } = await supabase
        .from("project_analyser")
        .select("enabled,status,graph_id")
        .eq("project_id", project_id)
        .maybeSingle<Pick<ProjectAnalyser, "enabled" | "status" | "graph_id">>()
    if (!analyser?.enabled || analyser.status !== "ready" || !analyser.graph_id) {
        return jsonError(
            "needs_indexing",
            "Enable the analyser and run the first index on the Knowledge tab before creating issues.",
            409,
        )
    }

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
