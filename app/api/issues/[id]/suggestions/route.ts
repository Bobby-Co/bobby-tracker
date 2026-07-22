import { repoRead, requireIssueAccess } from "@/lib/server/http/api"
import { createSupabaseIssuesRepository } from "@/modules/issues"

// GET /api/issues/[id]/suggestions
//
// Returns the latest cached suggestion for an issue (or null). Used by the
// issue detail panel for instant display without re-running the analyser.
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { supabase, error } = await requireIssueAccess(id)
    if (error) return error

    const issues = createSupabaseIssuesRepository(supabase)
    const { data, error: dbErr } = await repoRead(() => issues.findLatestSuggestion(id))
    if (dbErr) return dbErr
    return Response.json({ suggestion: data })
}
