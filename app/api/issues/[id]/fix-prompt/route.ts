import { jsonError, requireUser } from "@/lib/api"
import { composeIssueFixPrompt } from "@/lib/issue-prompt"
import type {
    Issue,
    IssueSuggestion,
    Project,
    ProjectAnalyser,
} from "@/lib/supabase/types"

// GET /api/issues/[id]/fix-prompt
//
// Bundles the issue, its parent project's stack rollup, and the latest
// cached analyser run into a single markdown prompt the user can paste
// into another coding AI. Pure read — never triggers a fresh analyser
// run. If no suggestion exists yet the prompt is still composed from
// the issue + project context alone.
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { supabase, error } = await requireUser()
    if (error) return error

    const { data: issue, error: iErr } = await supabase
        .from("issues")
        .select("id,project_id,issue_number,title,body,status,priority,labels,created_at,updated_at")
        .eq("id", id)
        .single<
            Pick<
                Issue,
                | "id"
                | "project_id"
                | "issue_number"
                | "title"
                | "body"
                | "status"
                | "priority"
                | "labels"
                | "created_at"
                | "updated_at"
            >
        >()
    if (iErr || !issue) return jsonError("not_found", "issue not found", 404)

    const [{ data: project }, { data: analyser }, { data: suggestion }] = await Promise.all([
        supabase
            .from("projects")
            .select("name,repo_url,repo_full_name,description")
            .eq("id", issue.project_id)
            .single<Pick<Project, "name" | "repo_url" | "repo_full_name" | "description">>(),
        supabase
            .from("project_analyser")
            .select("summary_markdown")
            .eq("project_id", issue.project_id)
            .maybeSingle<Pick<ProjectAnalyser, "summary_markdown">>(),
        supabase
            .from("issue_suggestions")
            .select("*")
            .eq("issue_id", issue.id)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle<IssueSuggestion>(),
    ])
    if (!project) return jsonError("not_found", "project not found", 404)

    const prompt = composeIssueFixPrompt({
        project,
        analyser: analyser ?? null,
        issue,
        suggestion: suggestion ?? null,
    })
    return Response.json({ prompt, has_analysis: !!suggestion })
}
