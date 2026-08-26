import { getAnalyser } from "@/modules/analysis"
import { ApiContext, jsonError, repoRead } from "@/lib/server/http/api"
import { tryOrNull } from "@/lib/shared/kernel"

// DELETE /api/projects/[id]/branches/[branch] — stop tracking a branch
//
// Branch names contain slashes far more often than not, so the segment is
// URL-encoded by the caller and decoded here. Next gives us the raw segment;
// "feat%2Fmulti-branch" arrives as one param rather than two path segments.
//
// Drops the analyser's graph as well as the row. FalkorDB is in-memory, so an
// orphaned branch graph holds real memory on a shared server until it restarts
// — and nothing in this stack sweeps for them, because there is no scheduler.
// Best-effort: a graph that will not drop must not block the untrack, or the
// branch becomes impossible to remove from the UI.

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string; branch: string }> }) {
    const { id, branch: rawBranch } = await params
    const branch = decodeURIComponent(rawBranch)

    const { ctx, error } = await new ApiContext().requireProjectAccess(id)
    if (error) return error

    const existing = await tryOrNull(() => ctx.projectBranches.find(id, branch))
    if (!existing) return jsonError("not_found", "that branch is not tracked", 404)

    if (existing.graph_id) {
        const cell = await ctx.projects.findCell(id)
        if (cell) {
            await getAnalyser(cell)
                .deleteGraph(existing.graph_id)
                .catch(() => {
                    // Logged rather than surfaced: the user asked to stop
                    // tracking, and refusing to do that because a cleanup failed
                    // would leave them with a row they cannot remove.
                    console.warn(`[branches] could not drop graph ${existing.graph_id} for ${id}/${branch}`)
                })
        }
    }

    const { data, error: delErr } = await repoRead(() => ctx.projectBranches.untrack(id, branch))
    if (delErr) return delErr
    if (!data) return jsonError("not_found", "that branch is not tracked", 404)
    return Response.json({ status: "untracked", branch })
}
