import { ApiContext, repoRead } from "@/lib/server/http/api"

// GET /api/issues/[id]/suggestions
//
// Returns the latest cached suggestion for an issue (or null). Used by the
// issue detail panel for instant display without re-running the analyser.
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { ctx, error } = await new ApiContext().requireIssueAccess(id)
    if (error) return error

    const issues = ctx.issues
    const { data, error: dbErr } = await repoRead(() => issues.findLatestSuggestion(id))
    if (dbErr) return dbErr
    return Response.json({ suggestion: data })
}