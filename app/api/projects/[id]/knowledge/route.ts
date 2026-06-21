import { jsonError, requireUser } from "@/lib/api"
import type { Project, ProjectAnalyser } from "@/lib/supabase/types"

// GET /api/projects/[id]/knowledge — the project's repo identity plus
// its analyser row. Backs both the Knowledge and Ask tabs, which each
// need the same { project, analyser } shape: the repo ref for source
// links and the analyser state to decide whether the graph is ready.
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { supabase, error } = await requireUser()
    if (error) return error

    const [{ data: project }, { data: analyser, error: analyserErr }] = await Promise.all([
        supabase
            .from("projects")
            .select("id,repo_url,repo_full_name")
            .eq("id", id)
            .single<Pick<Project, "id" | "repo_url" | "repo_full_name">>(),
        supabase
            .from("project_analyser")
            .select("*")
            .eq("project_id", id)
            .maybeSingle<ProjectAnalyser>(),
    ])
    if (analyserErr) return jsonError("db_error", analyserErr.message, 500)

    return Response.json({ project: project ?? null, analyser: analyser ?? null })
}
