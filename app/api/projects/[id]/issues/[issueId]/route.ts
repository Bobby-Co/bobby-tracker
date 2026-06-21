import { jsonError, requireUser } from "@/lib/api"
import type {
    Issue,
    IssueSuggestion,
    Project,
    ProjectAnalyser,
    ProjectLabelIcon,
    ProjectStatusColor,
} from "@/lib/supabase/types"

// GET /api/projects/[id]/issues/[issueId]
//
// Consolidated page-data endpoint for the issue-detail page. It replaces
// the 7 separate client fetches the page used to fire (issue, project,
// analyser, latest suggestion, "peek" issues, label icons, status
// colors) with ONE Worker invocation + ONE requireUser() check, running
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
    const { supabase, error } = await requireUser()
    if (error) return error

    const [issueR, projectR, analyserR, suggestionR, peekR, iconsR, colorsR] =
        await Promise.all([
            supabase.from("issues").select("*").eq("id", issueId).eq("project_id", id).maybeSingle<Issue>(),
            supabase.from("projects").select("*").eq("id", id).maybeSingle<Project>(),
            supabase.from("project_analyser").select("*").eq("project_id", id).maybeSingle<ProjectAnalyser>(),
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

    const dbErr =
        issueR.error || projectR.error || analyserR.error ||
        suggestionR.error || peekR.error || iconsR.error || colorsR.error
    if (dbErr) return jsonError("db_error", dbErr.message, 500)

    return Response.json({
        issue: issueR.data,
        project: projectR.data,
        analyser: analyserR.data,
        suggestion: suggestionR.data,
        peekOthers: peekR.data ?? [],
        labelIcons: iconsR.data ?? [],
        statusColors: colorsR.data ?? [],
    })
}
