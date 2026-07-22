import { jsonError, repoRead, requireIssueAccess } from "@/lib/platform/http/api"
import { IssuePrompt, createSupabaseIssuesRepository } from "@/modules/issues"
import { createSupabaseProjectsRepository } from "@/modules/projects"

// GET /api/issues/[id]/fix-prompt
//
// Bundles the issue and the latest cached analyser run into a single
// markdown prompt the user can paste into another coding AI. Pure read
// — never triggers a fresh analyser run. If no suggestion exists yet
// the prompt is still composed from the issue + project context alone.
//
// The prompt deliberately omits the project's stack/architecture
// rollup (`project_analyser.summary_markdown`) — the receiving AI
// rediscovers that from the repo faster than it can read it.
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { supabase, error } = await requireIssueAccess(id)
    if (error) return error

    const issues = createSupabaseIssuesRepository(supabase)
    const projects = createSupabaseProjectsRepository(supabase)
    const { data: issue, error: iErr } = await repoRead(() => issues.findSuggestContext(id))
    if (iErr) return iErr
    if (!issue) return jsonError("not_found", "issue not found", 404)

    const [{ data: project, error: pErr }, { data: suggestion, error: sErr }] = await Promise.all([
        repoRead(() => projects.findAnalysisContext(issue.project_id)),
        repoRead(() => issues.findLatestSuggestion(issue.id)),
    ])
    if (pErr) return pErr
    if (sErr) return sErr
    if (!project) return jsonError("not_found", "project not found", 404)

    const prompt = new IssuePrompt().compose({
        project,
        issue,
        suggestion: suggestion ?? null,
    })
    return Response.json({ prompt, has_analysis: !!suggestion })
}
