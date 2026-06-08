import { jsonError, requireUser } from "@/lib/api"
import { composeIssueFixPrompt } from "@/lib/issue-prompt"
import type { Issue, IssueSuggestion, Project } from "@/lib/supabase/types"

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
    const { supabase, error } = await requireUser()
    if (error) return error

    const { data: issue, error: iErr } = await supabase
        .from("issues")
        .select("id,project_id,issue_number,title,body,status,priority,labels")
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
            >
        >()
    if (iErr || !issue) return jsonError("not_found", "issue not found", 404)

    const [{ data: project }, { data: suggestion }] = await Promise.all([
        supabase
            .from("projects")
            .select("name,repo_url,repo_full_name,description")
            .eq("id", issue.project_id)
            .single<Pick<Project, "name" | "repo_url" | "repo_full_name" | "description">>(),
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
        issue,
        suggestion: suggestion ?? null,
    })
    return Response.json({ prompt, has_analysis: !!suggestion })
}
