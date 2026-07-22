import { ApiContext, repoRead } from "@/lib/server/http/api"
import { createSupabaseProjectAnalyserRepository } from "@/modules/analysis"
import type { Project } from "@/lib/shared/types"

// GET /api/projects/[id]/knowledge — the project's repo identity plus
// its analyser row. Backs both the Knowledge and Ask tabs, which each
// need the same { project, analyser } shape: the repo ref for source
// links and the analyser state to decide whether the graph is ready.
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { supabase, error } = await new ApiContext().requireProjectAccess(id)
    if (error) return error

    const [{ data: project }, { data: analyser, error: analyserErr }] = await Promise.all([
        supabase
            .from("projects")
            .select("id,repo_url,repo_full_name")
            .eq("id", id)
            .single<Pick<Project, "id" | "repo_url" | "repo_full_name">>(),
        repoRead(() => createSupabaseProjectAnalyserRepository(supabase).findByProjectId(id)),
    ])
    if (analyserErr) return analyserErr

    return Response.json({ project: project ?? null, analyser: analyser ?? null })
}
