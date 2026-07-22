import { after } from "next/server"
import { ApiContext, repoRead } from "@/lib/server/http/api"
import { getPullRequestServiceForProject } from "@/modules/vcs"

// GET /api/projects/[id]/pulls
//
// Lists the project's mirrored pull requests (tracker.pull_requests), each
// overlaid with Bobby's review status (tracker.pull_request_analyses, matched by
// pr_number). When the mirror is empty — a project synced before the PR tab
// existed — we kick a detached backfill and return { syncing: true } so the page
// can show a "syncing…" state; the next load is populated.
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { ctx, error } = await new ApiContext().requireProjectAccess(id)
    if (error) return error

    const [pullsR, analysesR] = await Promise.all([
        repoRead(() => ctx.pullRequests.listForProject(id)),
        repoRead(() => ctx.pullRequests.listAnalysisStatuses(id)),
    ])
    if (pullsR.error) return pullsR.error
    if (analysesR.error) return analysesR.error

    const pulls = pullsR.data
    if (pulls.length === 0) {
        after(async () => {
            const prs = await getPullRequestServiceForProject(id)
            await prs?.backfillPullRequests(id)
        })
        return Response.json({ pulls: [], syncing: true })
    }

    const statusByPr = new Map(analysesR.data.map((a) => [a.pr_number, a.status]))
    const withReview = pulls.map((pr) => ({
        ...pr,
        review_status: statusByPr.get(pr.pr_number) ?? null,
    }))

    return Response.json({ pulls: withReview, syncing: false })
}
