import { ApiContext, repoRead } from "@/lib/server/http/api"

// GET /api/issues/[id]/suggestions
//
// Returns the latest cached suggestion for an issue (or null). Used by the
// issue detail panel for instant display without re-running the analyser.
//
// `analysisStatus` rides along for the suggestion box's polling fallback: a
// detached /analyse run that ends 'failed' or 'cancelled' never writes a row,
// so without this the UI has no way to tell "still running" from "over, with
// nothing to show" and would animate forever.
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { ctx, error } = await new ApiContext().requireIssueAccess(id)
    if (error) return error

    const issues = ctx.issues
    const suggestions = ctx.issueSuggestions
    const [suggestionR, issueR] = await Promise.all([
        repoRead(() => suggestions.findLatest(id)),
        repoRead(() => issues.findById(id)),
    ])
    if (suggestionR.error) return suggestionR.error
    if (issueR.error) return issueR.error

    return Response.json({
        suggestion: suggestionR.data,
        analysisStatus: issueR.data?.analysis_status ?? null,
    })
}
