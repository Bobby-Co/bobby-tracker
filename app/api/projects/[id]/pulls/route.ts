import { after } from "next/server"
import { jsonError, requireProjectAccess } from "@/lib/platform/http/api"
import { backfillPullRequests } from "@/modules/pull-requests"
import type { PullRequest, PullRequestAnalysis } from "@/lib/supabase/types"

// GET /api/projects/[id]/pulls
//
// Lists the project's mirrored pull requests (tracker.pull_requests), each
// overlaid with Bobby's review status (tracker.pull_request_analyses, matched by
// pr_number). When the mirror is empty — a project synced before the PR tab
// existed — we kick a detached backfill and return { syncing: true } so the page
// can show a "syncing…" state; the next load is populated.
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { supabase, error } = await requireProjectAccess(id)
    if (error) return error

    const [pullsR, analysesR] = await Promise.all([
        supabase
            .from("pull_requests")
            .select("*")
            .eq("project_id", id)
            .order("gh_updated_at", { ascending: false, nullsFirst: false })
            .limit(500)
            .returns<PullRequest[]>(),
        supabase
            .from("pull_request_analyses")
            .select("pr_number,status")
            .eq("project_id", id)
            .returns<Pick<PullRequestAnalysis, "pr_number" | "status">[]>(),
    ])

    if (pullsR.error || analysesR.error) {
        return jsonError("db_error", (pullsR.error || analysesR.error)!.message, 500)
    }

    const pulls = pullsR.data ?? []
    if (pulls.length === 0) {
        after(() => backfillPullRequests(id))
        return Response.json({ pulls: [], syncing: true })
    }

    const statusByPr = new Map(analysesR.data?.map((a) => [a.pr_number, a.status]) ?? [])
    const withReview = pulls.map((pr) => ({
        ...pr,
        review_status: statusByPr.get(pr.pr_number) ?? null,
    }))

    return Response.json({ pulls: withReview, syncing: false })
}
