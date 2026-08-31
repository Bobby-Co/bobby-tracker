import { ApiContext, jsonError, repoRead } from "@/lib/server/http/api"
import { tryOrNull } from "@/lib/shared/kernel"
import { getVcsAppService } from "@/modules/vcs"

/** Just the repositories this route reaches for — the ApiContext's shape,
 *  narrowed so the helper below states what it actually needs. */
type ApiContextRepos = Awaited<ReturnType<ApiContext["requireProjectAccess"]>>["ctx"]

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
    const branches = data ?? []

    // The default branch's NAME rides along, so a picker can offer "Default
    // branch (main)" rather than asking someone to choose between a named
    // branch and an unnamed one.
    //
    // Resolved lazily and ONLY when this project actually tracks branches:
    // that is the only case where the name will be displayed, and it confines
    // the one-off provider round-trip to projects that have a use for it. A
    // project nobody tracks branches on never pays for it. Once learned it is
    // stored (0095), so this costs at most one call per project — and the
    // webhooks usually get there first.
    const defaultBranch = branches.length > 0 ? await resolveDefaultBranch(ctx, id) : null

    return Response.json({ branches, default_branch: defaultBranch })
}

/** The project's default branch name, from the column when we have it and from
 *  the provider (persisted) the first time we don't.
 *
 *  Every failure path returns null, which every reader renders as the generic
 *  "Default branch". A label is never worth failing a request for. */
async function resolveDefaultBranch(ctx: ApiContextRepos, projectId: string): Promise<string | null> {
    const project = await tryOrNull(() => ctx.projects.findFull(projectId))
    if (!project) return null
    if (project.default_branch) return project.default_branch

    const vcs = getVcsAppService(project)
    if (!vcs) return null
    const branches = await tryOrNull(() => vcs.listBranches())
    const found = branches?.find((b) => b.isDefault)?.name
    if (!found) return null

    await tryOrNull(() => ctx.projects.recordDefaultBranch(projectId, found))
    return found
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
    const bad = invalidBranchReason(branch)
    if (bad) return jsonError("bad_request", bad, 400)

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

// git's own rules for a ref name, kept to the parts that matter here.
//
// This is not politeness about invalid input. The name is concatenated into the
// analyser's graph id — "<repoId>@branch/<name>" — and that id is joined onto a
// filesystem path when a graph is torn down. A name containing ".." would climb
// out of the graph root and delete something else. git would never produce such
// a branch; an HTTP client will happily send one.
//
// The analyser refuses to delete outside its graph root as well. Two checks,
// because the one that matters is whichever is still there after a refactor.
function invalidBranchReason(branch: string): string | null {
    if (branch.length > 255) return "that branch name is too long"
    if (/\s/.test(branch)) return "a branch name cannot contain whitespace"
    if (/[\x00-\x1f\x7f~^:?*[\\]/.test(branch)) return "that branch name contains characters git does not allow"
    if (branch.split("/").some((seg) => seg === "" || seg === "." || seg === "..")) {
        return "that is not a valid branch name"
    }
    if (branch.startsWith("/") || branch.endsWith("/") || branch.endsWith(".lock")) {
        return "that is not a valid branch name"
    }
    return null
}
