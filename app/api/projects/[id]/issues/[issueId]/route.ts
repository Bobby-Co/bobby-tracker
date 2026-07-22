import { after } from "next/server"
import { ApiContext, jsonError, repoRead } from "@/lib/server/http/api"
import { createSupabaseProjectAnalyserRepository } from "@/modules/analysis"
import { getPullRequestServiceForProject } from "@/modules/vcs"
import type {
    Issue,
    IssueComment,
    IssueSuggestion,
    Project,
    ProjectLabelIcon,
    ProjectStatusColor,
} from "@/lib/shared/types"

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
    const { supabase, error } = await new ApiContext().requireProjectAccess(id)
    if (error) return error

    const [issueR, projectR, analyserR, suggestionR, peekR, iconsR, colorsR] =
        await Promise.all([
            supabase.from("issues").select("*").eq("id", issueId).eq("project_id", id).maybeSingle<Issue>(),
            supabase.from("projects").select("*").eq("id", id).maybeSingle<Project>(),
            repoRead(() => createSupabaseProjectAnalyserRepository(supabase).findByProjectId(id)),
            supabase
                .from("issue_suggestions")
                .select("*")
                .eq("issue_id", issueId)
                .order("created_at", { ascending: false })
                .limit(1)
                .maybeSingle<IssueSuggestion>(),
            supabase
                .from("issues")
                .select("*")
                .eq("project_id", id)
                .not("starts_at", "is", null)
                .not("ends_at", "is", null)
                .returns<Issue[]>(),
            supabase.from("project_label_icons").select("*").eq("project_id", id).returns<ProjectLabelIcon[]>(),
            supabase.from("project_status_colors").select("*").eq("project_id", id).returns<ProjectStatusColor[]>(),
        ])

    if (analyserR.error) return analyserR.error
    const dbErr =
        issueR.error || projectR.error ||
        suggestionR.error || peekR.error || iconsR.error || colorsR.error
    if (dbErr) return jsonError("db_error", dbErr.message, 500)

    // The GitHub comment thread is keyed by the issue's GitHub number, which we
    // only know once the issue row resolves — so it's a second read (only for
    // issues that exist on GitHub). Lazy-backfill an empty thread, like PR detail.
    let comments: IssueComment[] = []
    const ghNumber = issueR.data?.github_issue_number ?? null
    if (ghNumber) {
        const commentsR = await supabase
            .from("issue_comments")
            .select("*")
            .eq("project_id", id)
            .eq("issue_number", ghNumber)
            .order("gh_created_at", { ascending: true, nullsFirst: true })
            .returns<IssueComment[]>()
        comments = commentsR.data ?? []
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
        peekOthers: peekR.data ?? [],
        labelIcons: iconsR.data ?? [],
        statusColors: colorsR.data ?? [],
        comments,
    })
}
