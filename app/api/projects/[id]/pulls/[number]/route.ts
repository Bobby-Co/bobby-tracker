import { after } from "next/server"
import { jsonError, requireProjectAccess } from "@/lib/platform/http/api"
import { backfillPullRequestComments } from "@/modules/pull-requests"
import type { PRComment, Project, PullRequest, PullRequestAnalysis } from "@/lib/supabase/types"

// GET /api/projects/[id]/pulls/[number]
//
// Consolidated page-data endpoint for the PR-detail page (one Worker invocation,
// one requireUser, one Promise.all — same shape as the issue-detail route). It
// returns the mirrored PR, its project, Bobby's persisted review, and the synced
// comment thread. If the PR is mirrored but has no comments yet (e.g. an older PR
// beyond the backfill cap), it kicks a detached per-PR comment backfill so a
// refresh fills the thread.
export async function GET(_: Request, { params }: { params: Promise<{ id: string; number: string }> }) {
    const { id, number } = await params
    const prNumber = Number(number)
    if (!Number.isInteger(prNumber)) return jsonError("bad_request", "invalid PR number", 400)

    const { supabase, error } = await requireProjectAccess(id)
    if (error) return error

    const [pullR, projectR, analysisR, commentsR] = await Promise.all([
        supabase
            .from("pull_requests")
            .select("*")
            .eq("project_id", id)
            .eq("pr_number", prNumber)
            .maybeSingle<PullRequest>(),
        supabase
            .from("projects")
            .select("id,name,repo_url,repo_full_name")
            .eq("id", id)
            .maybeSingle<Pick<Project, "id" | "name" | "repo_url" | "repo_full_name">>(),
        supabase
            .from("pull_request_analyses")
            .select("*")
            .eq("project_id", id)
            .eq("pr_number", prNumber)
            .maybeSingle<PullRequestAnalysis>(),
        supabase
            .from("pr_comments")
            .select("*")
            .eq("project_id", id)
            .eq("pr_number", prNumber)
            .order("gh_created_at", { ascending: true, nullsFirst: true })
            .returns<PRComment[]>(),
    ])

    const dbErr = pullR.error || projectR.error || analysisR.error || commentsR.error
    if (dbErr) return jsonError("db_error", dbErr.message, 500)

    const comments = commentsR.data ?? []
    // A mirrored PR with an empty thread: fill it lazily so the next load shows it.
    if (pullR.data && comments.length === 0) {
        after(() => backfillPullRequestComments(id, prNumber))
    }

    return Response.json({
        pull: pullR.data,
        project: projectR.data,
        analysis: analysisR.data,
        comments,
    })
}
