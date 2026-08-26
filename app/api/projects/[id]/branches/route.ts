import { ApiContext, jsonError, repoRead } from "@/lib/server/http/api"
import { tryOrNull } from "@/lib/shared/kernel"

// GET  /api/projects/[id]/branches — the branches this project keeps indexed
// POST /api/projects/[id]/branches — start tracking one
//
// The DEFAULT branch is deliberately absent from both. It lives in
// project_analyser and always has; a project with no rows here behaves exactly
// as it did before branches existed. Listing it alongside tracked branches
// would invite the UI to offer "untrack" on the one branch that cannot be
// untracked.
//
// Tracking does NOT index. It records the intent and returns a `pending` row;
// the index runs from POST .../branches/[branch]/index, which is the route that
// can fail slowly and needs its own error surface.

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { ctx, error } = await new ApiContext().requireProjectAccess(id)
    if (error) return error

    const { data, error: readErr } = await repoRead(() => ctx.projectBranches.listByProject(id))
    if (readErr) return readErr
    return Response.json({ branches: data ?? [] })
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { ctx, error } = await new ApiContext().requireProjectAccess(id)
    if (error) return error

    let body: Record<string, unknown> = {}
    try {
        body = await request.json()
    } catch {}

    const branch = typeof body.branch === "string" ? body.branch.trim() : ""
    if (!branch) return jsonError("bad_request", "branch is required", 400)
    // The name becomes a FalkorDB key verbatim, and the DB carries the same
    // check — rejecting here just gives a better message than a constraint
    // violation would.
    if (/\s/.test(branch)) return jsonError("bad_request", "a branch name cannot contain whitespace", 400)
    if (branch.length > 255) return jsonError("bad_request", "that branch name is too long", 400)

    // A branch is a copy of the repository's graph plus a replay. Without a
    // bootstrapped repository there is nothing to copy, and the analyser would
    // refuse — better to say so here than to leave a pending row that can never
    // become ready.
    const readiness = await tryOrNull(() => ctx.analyser.findReadiness(id))
    if (!readiness?.graph_id) {
        return jsonError("not_indexed", "Index this project before tracking extra branches.", 409)
    }

    const { data, error: writeErr } = await repoRead(() => ctx.projectBranches.track(id, branch))
    if (writeErr) return writeErr
    return Response.json({ branch: data }, { status: 201 })
}
