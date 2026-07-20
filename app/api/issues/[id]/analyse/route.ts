import { jsonError, requireIssueAccess } from "@/lib/api"
import { ensureAnalysis } from "@/modules/github"
import type { IssueSuggestion } from "@/lib/supabase/types"

export const dynamic = "force-dynamic"

// POST /api/issues/[id]/analyse — ensure the SINGLE analysis run for this issue
// is under way (idempotent / one-shot). The suggestion box calls this instead
// of /suggest so it shares the same run as the GitHub-comment flow rather than
// starting a duplicate. Returns the cached suggestion when the run already
// finished; otherwise the result lands via the issue_suggestions realtime
// INSERT the box is subscribed to.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { supabase, error } = await requireIssueAccess(id)
    if (error) return error

    // Ownership (RLS): the cookie client only sees the caller's issues.
    const { data: owned } = await supabase
        .from("issues")
        .select("id")
        .eq("id", id)
        .maybeSingle<{ id: string }>()
    if (!owned) return jsonError("not_found", "issue not found", 404)

    const status = await ensureAnalysis(id, new URL(request.url).origin)
    if (status === "not_ready") {
        return jsonError(
            "needs_indexing",
            "Enable the bobby-analyser integration and run an index for this project before requesting suggestions.",
            409,
        )
    }
    if (status === "no_issue") return jsonError("not_found", "issue not found", 404)

    // Return the cached suggestion if the run already completed (status 'done').
    const { data: suggestion } = await supabase
        .from("issue_suggestions")
        .select("*")
        .eq("issue_id", id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle<IssueSuggestion>()
    return Response.json({ status, suggestion: suggestion ?? null })
}
