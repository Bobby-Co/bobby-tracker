import { after } from "next/server"
import { ApiContext, repoRead } from "@/lib/server/http/api"
import { tryOrNull } from "@/lib/shared/kernel"
import { getPullRequestServiceForProject } from "@/modules/vcs"
import type { IssueComment } from "@/lib/shared/types"

// GET /api/projects/[id]/issues/[issueId]
//
// Consolidated page-data endpoint for the issue-detail page. It replaces
// the 7 separate client fetches the page used to fire (issue, project,
// analyser, latest suggestion, "peek" issues, label icons, status
// colors) with ONE Worker invocation + ONE new ApiContext().requireUser() check, running
// all reads in a single Promise.all.
//
// Why this matters on Cloudflare: each Worker invocation pays the
// OpenNext/Next server-init CPU cost, so 7 concurrent invocations per
// page open = 7× that fixed cost. Collapsing to 1 is a direct CPU/cost
// reduction (the DB queries themselves are I/O, not CPU).
//
// "peekOthers" is also narrowed to *scheduled* issues server-side
// (starts_at + ends_at set) rather than shipping the entire issue list
// and filtering it in the browser.
export async function GET(
    _: Request,
    { params }: { params: Promise<{ id: string; issueId: string }> },
) {
    const { id, issueId } = await params
    const { ctx, error } = await new ApiContext().requireProjectAccess(id)
    if (error) return error

    const [issueR, projectR, analyserR, suggestionR, peekR, iconsR, colorsR] = await Promise.all([
        repoRead(() => ctx.issues.findByIdInProject(issueId, id)),
        repoRead(() => ctx.projects.findFull(id)),
        repoRead(() => ctx.analyser.findByProjectId(id)),
        repoRead(() => ctx.issues.findLatestSuggestion(issueId)),
        repoRead(() => ctx.issues.listScheduled(id)),
        repoRead(() => ctx.projectDisplay.listLabelIcons(id)),
        repoRead(() => ctx.projectDisplay.listStatusColors(id)),
    ])
    const readErr =
        issueR.error || projectR.error || analyserR.error ||
        suggestionR.error || peekR.error || iconsR.error || colorsR.error
    if (readErr) return readErr

    // The GitHub comment thread is keyed by the issue's GitHub number, which we
    // only know once the issue row resolves — so it's a second read (only for
    // issues that exist on GitHub). Lazy-backfill an empty thread, like PR detail.
    let comments: IssueComment[] = []
    const ghNumber = issueR.data?.github_issue_number ?? null
    if (ghNumber) {
        comments = (await tryOrNull(() => ctx.issueComments.listComments(id, ghNumber))) ?? []
        if (comments.length === 0) {
            after(async () => {
                const prs = await getPullRequestServiceForProject(id)
                await prs?.backfillIssueComments(id, ghNumber)
            })
        }
    }

    return Response.json({
        issue: issueR.data,
        project: projectR.data,
        analyser: analyserR.data,
        suggestion: suggestionR.data,
        peekOthers: peekR.data,
        labelIcons: iconsR.data,
        statusColors: colorsR.data,
        comments,
    })
}
