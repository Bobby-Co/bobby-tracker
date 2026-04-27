import { analyseIssue, AnalyserError } from "@/lib/analyser"
import { jsonError, requireUser } from "@/lib/api"
import type { Issue, IssueSuggestion, ProjectAnalyser } from "@/lib/supabase/types"

// POST /api/issues/[id]/suggest
//
// Calls bobby-analyser's structured /issues/analyse endpoint and caches
// the response in tracker.issue_suggestions. Synchronous — typically
// returns inside ~30s once the graph is indexed.
//
// Returns 409 with code "needs_indexing" if project_analyser isn't
// ready, so the UI can prompt the user to enable + index first.
export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { supabase, error } = await requireUser()
    if (error) return error

    const { data: issue, error: iErr } = await supabase
        .from("issues")
        .select("id,project_id,title,body,labels,priority")
        .eq("id", id)
        .single<Pick<Issue, "id" | "project_id" | "title" | "body" | "labels" | "priority">>()
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
        const result = await analyseIssue({
            repoId:   analyser.graph_id,
            title:    issue.title,
            body:     issue.body || "",
            labels:   issue.labels,
            priority: issue.priority,
        })

        const { data: row, error: insErr } = await supabase
            .from("issue_suggestions")
            .insert({
                issue_id:    issue.id,
                data:        result,
                markdown:    result.markdown ?? result.summary ?? "",
                code_cites:  (result.suggestions ?? []).map((s) => ({ file: s.file, line: s.line })),
                graph_cites: result.graph_cites ?? [],
                confidence:  result.confidence ?? null,
                cost_usd:    result.cost_usd ?? 0,
                duration_ms: result.duration_ms ?? 0,
                graph_id:    analyser.graph_id,
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
