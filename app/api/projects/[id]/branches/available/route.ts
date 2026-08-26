import { getVcsAppService } from "@/modules/vcs"
import { ApiContext, jsonError } from "@/lib/server/http/api"
import { tryOrNull } from "@/lib/shared/kernel"

// GET /api/projects/[id]/branches/available — the repo's branches, for the picker.
//
// Live from the provider rather than a mirrored table: branches are created and
// deleted constantly and nothing in this stack syncs them, so a cached list
// would offer branches that no longer exist and miss the one someone just
// pushed — which is exactly when they want to index it.
//
// Excludes only the default branch — already indexed as the project's own graph,
// so it can be neither added nor removed. Branches already TRACKED are included:
// the picker is a multi-select showing which ones are indexed, so it has to be
// able to render them checked (and let them be unchecked).
//
// `protected` rides along as the suggested set. A protected branch is one a team
// has already said matters, which is a better default than "none" and a far
// better one than "all" — every tracked branch is resident in the analyser's
// memory.
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

    try {
        const all = await vcs.listBranches()
        const offerable = all
            .filter((b) => !b.isDefault)
            .map((b) => ({ name: b.name, protected: b.isProtected }))
            // Protected first — the ones most likely to be wanted — then
            // alphabetical within each half.
            .sort((a, b) =>
                a.protected === b.protected ? a.name.localeCompare(b.name) : a.protected ? -1 : 1,
            )
        return Response.json({ branches: offerable })
    } catch (e) {
        // Degrade to the free-text path rather than failing the panel.
        console.warn(`[branches] could not list branches for ${id}:`, e instanceof Error ? e.message : e)
        return Response.json({ branches: [], reason: "unavailable" })
    }
}
