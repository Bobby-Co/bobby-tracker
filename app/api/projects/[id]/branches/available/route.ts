import { getVcsAppService } from "@/modules/vcs"
import { ApiContext, jsonError, repoRead } from "@/lib/server/http/api"
import { tryOrNull } from "@/lib/shared/kernel"

// GET /api/projects/[id]/branches/available — the repo's branches, for the picker.
//
// Live from the provider rather than a mirrored table: branches are created and
// deleted constantly and nothing in this stack syncs them, so a cached list
// would offer branches that no longer exist and miss the one someone just
// pushed — which is exactly when they want to index it.
//
// Excludes the default branch (already indexed as the project's own graph) and
// anything already tracked, so the picker only ever offers additions.
//
// A provider that cannot answer is NOT an error here. The panel keeps a
// free-text fallback, and refusing to render the form because a listing failed
// would take away the working path along with the convenience one.

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { ctx, error } = await new ApiContext().requireProjectAccess(id)
    if (error) return error

    const project = await tryOrNull(() => ctx.projects.findFull(id))
    if (!project) return jsonError("not_found", "project not found", 404)

    const vcs = getVcsAppService(project)
    if (!vcs) return Response.json({ branches: [], reason: "no_provider" })

    const { data: tracked, error: readErr } = await repoRead(() => ctx.projectBranches.listByProject(id))
    if (readErr) return readErr
    const already = new Set((tracked ?? []).map((b) => b.branch))

    try {
        const all = await vcs.listBranches()
        const offerable = all
            .filter((b) => !b.isDefault && !already.has(b.name))
            .map((b) => b.name)
            .sort((a, b) => a.localeCompare(b))
        return Response.json({ branches: offerable })
    } catch (e) {
        // Degrade to the free-text path rather than failing the panel.
        console.warn(`[branches] could not list branches for ${id}:`, e instanceof Error ? e.message : e)
        return Response.json({ branches: [], reason: "unavailable" })
    }
}
