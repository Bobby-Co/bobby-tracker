import { jsonError, requireUser } from "@/lib/api"
import type { IssueSuggestion } from "@/lib/supabase/types"

// GET /api/issues/[id]/suggestions
//
// Returns the latest cached suggestion for an issue (or null). Used by the
// issue detail panel for instant display without re-running the analyser.
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { supabase, error } = await requireUser()
    if (error) return error

    const { data, error: dbErr } = await supabase
        .from("issue_suggestions")
        .select("*")
        .eq("issue_id", id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle<IssueSuggestion>()
    if (dbErr) return jsonError("db_error", dbErr.message, 500)
    return Response.json({ suggestion: data })
}
