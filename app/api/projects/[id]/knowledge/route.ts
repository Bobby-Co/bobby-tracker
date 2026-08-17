import { ApiContext, repoRead } from "@/lib/server/http/api"
import { tryOrNull } from "@/lib/shared/kernel"

// GET /api/projects/[id]/knowledge — the project's repo identity plus
// its analyser row. Backs both the Knowledge and Ask tabs, which each
// need the same { project, analyser } shape: the repo ref for source
// links and the analyser state to decide whether the graph is ready.
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { ctx, error } = await new ApiContext().requireProjectAccess(id)
    if (error) return error

    const [project, { data: analyser, error: analyserErr }] = await Promise.all([
        tryOrNull(() => ctx.projects.findRepoRef(id)),
        repoRead(() => ctx.analyser.findByProjectId(id)),
    ])
    if (analyserErr) return analyserErr

    return Response.json({ project: project ?? null, analyser: analyser ?? null })
}
