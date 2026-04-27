import { ask, AnalyserError } from "@/lib/analyser"
import { jsonError, requireUser } from "@/lib/api"
import type { Issue, IssueSuggestion, ProjectAnalyser } from "@/lib/supabase/types"

// POST /api/issues/[id]/suggest
//
// Triggers a fresh analyser /query for the issue, caches the result in
// tracker.issue_suggestions, and returns it. Synchronous — the analyser's
// /query endpoint typically returns inside ~30s for an indexed graph.
//
// Requires the project to have an enabled analyser graph (status='ready').
// Returns 409 with code "needs_indexing" otherwise so the UI can prompt
// the user to flip the integration toggle.
export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { supabase, error } = await requireUser()
    if (error) return error

    const { data: issue, error: iErr } = await supabase
        .from("issues")
        .select("id,project_id,title,body")
        .eq("id", id)
        .single<Pick<Issue, "id" | "project_id" | "title" | "body">>()
    if (iErr || !issue) return jsonError("not_found", "issue not found", 404)

    const { data: analyser, error: aErr } = await supabase
        .from("project_analyser")
        .select("*")
        .eq("project_id", issue.project_id)
        .maybeSingle<ProjectAnalyser>()
    if (aErr) return jsonError("db_error", aErr.message, 500)
    if (!analyser?.enabled || analyser.status !== "ready" || !analyser.graph_id) {
        return jsonError(
            "needs_indexing",
            "Enable the bobby-analyser integration and run an index for this project before requesting suggestions.",
            409,
        )
    }

    try {
        const question = composeQuestion(issue.title, issue.body)
        const result = await ask(analyser.graph_id, question)

        const { data: row, error: insErr } = await supabase
            .from("issue_suggestions")
            .insert({
                issue_id: issue.id,
                markdown: result.markdown,
                code_cites: result.code_cites ?? [],
                graph_cites: result.graph_cites ?? [],
                confidence: result.confidence ?? null,
                cost_usd: result.cost_usd ?? 0,
                duration_ms: result.duration_ms ?? 0,
                graph_id: analyser.graph_id,
            })
            .select("*")
            .single<IssueSuggestion>()
        if (insErr) return jsonError("db_error", insErr.message, 500)
        return Response.json({ suggestion: row })
    } catch (e) {
        const code = e instanceof AnalyserError ? e.code : "analyser_failed"
        const message = e instanceof Error ? e.message : String(e)
        return jsonError(code, message, 502)
    }
}

// composeQuestion builds the question we hand to the analyser. The agent
// works best with a single clear ask — we lead with the title (most
// signal-dense), then include up to ~8 KB of body so long bug reports
// aren't chopped at sentence boundaries that lose context. The header
// nudges the agent to surface concrete file:line citations.
function composeQuestion(title: string, body: string): string {
    const prompt = `An issue has been filed in our tracker. Investigate the codebase and explain which files, functions, and lines a developer should look at first to fix it. Cite file:line where you can.

Title: ${title}`
    if (!body || !body.trim()) return prompt
    const trimmed = body.length > 8000 ? body.slice(0, 8000) + "\n\n[…truncated]" : body
    return `${prompt}\n\nDescription:\n${trimmed}`
}
