import { createServiceClient } from "@/lib/supabase/server"
import type { IssueSuggestion, ProjectAnalyser, PublicIssueReporter } from "@/lib/supabase/types"
import { fetchPublicIssue, requireInviteAccess, requireOwnVisibility, resolvePublicSession } from "@/lib/public-session"

// GET /api/public-issues/[id]?token=<session_token>
//
// Returns the issue's content + the latest cached AI suggestion to an
// anonymous viewer who holds a valid session token. We gate access on
// (a) the token resolving to an enabled session and (b) the issue
// carrying the `public-session` label — together they prevent leaking
// internal issues that the owner filed themselves. Doesn't enforce
// the time-window: a submitter looking back at their own issues should
// keep working even after the link closes.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const url = new URL(request.url)
    const token = (url.searchParams.get("token") || "").trim()

    const svc = createServiceClient()
    const sess = await resolvePublicSession(svc, token, { requireOpen: false })
    if (sess.error) return sess.error

    const inviteErr = await requireInviteAccess(sess.session)
    if (inviteErr) return inviteErr

    const visErr = await requireOwnVisibility(svc, sess.session, id)
    if (visErr) return visErr

    const found = await fetchPublicIssue(svc, id, sess.session.project_ids)
    if (found.error) return found.error
    const issue = found.issue

    const { data: suggestion } = await svc
        .from("issue_suggestions")
        .select("*")
        .eq("issue_id", id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle<IssueSuggestion>()

    const { data: reporter } = await svc
        .from("public_issue_reporters")
        .select("reporter_id,reporter_name")
        .eq("issue_id", id)
        .maybeSingle<Pick<PublicIssueReporter, "reporter_id" | "reporter_name">>()

    const { data: analyser } = await svc
        .from("project_analyser")
        .select("enabled,status,graph_id,last_indexed_sha")
        .eq("project_id", issue.project_id)
        .maybeSingle<Pick<ProjectAnalyser, "enabled" | "status" | "graph_id" | "last_indexed_sha">>()

    const analyserReady =
        !!analyser?.enabled && analyser.status === "ready" && !!analyser.graph_id

    return Response.json({
        issue: {
            id: issue.id,
            issue_number: issue.issue_number,
            title: issue.title,
            body: issue.body,
            status: issue.status,
            priority: issue.priority,
            labels: issue.labels,
            created_at: issue.created_at,
            updated_at: issue.updated_at,
        },
        reporter: {
            id: reporter?.reporter_id ?? null,
            name: reporter?.reporter_name ?? null,
        },
        suggestion: suggestion ?? null,
        analyser: {
            ready: analyserReady,
            status: analyser?.status ?? "disabled",
            indexed_sha: analyser?.last_indexed_sha ?? null,
        },
    })
}
