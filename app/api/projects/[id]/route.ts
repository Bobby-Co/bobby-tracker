import { getAnalyser } from "@/modules/analysis"
import { ApiContext, forbidden, jsonError, repoRead } from "@/lib/server/http/api"
import { tryOrNull } from "@/lib/shared/kernel"
import { Role } from "@/modules/access"
import type { ProjectPatch } from "@/modules/projects"
import { DUPLICATE_SENSITIVITIES } from "@/modules/issues"
import { findIcon } from "@/lib/shared/icons/iconly"
import { ICONLY_NAMES } from "@/lib/shared/icons/iconly-catalog"
import { dataClientForCell } from "@/lib/server/regional"

// Same gate as the label-icons route: only slugs the renderer can actually draw
// (the 361-icon catalog, or a legacy path-based icon) are allowed to be stored.
function isKnownIconName(name: string): boolean {
    return ICONLY_NAMES.has(name) || !!findIcon(name)
}

// GET /api/projects/[id] — single project. Shape: { project: Project | null }.
// RLS blocks cross-team reads; AccessService.canAccessProject adds the group-level
// gate so a plain member can't open a same-team project they weren't granted
// (returns 404, not 403, so we don't reveal the project exists).
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { ctx, user, error } = await new ApiContext().requireUser()
    if (error) return error
    const access = await ctx.access.canAccessProject(user.id, id)
    if (!access.ok) return Response.json({ project: null })
    const { data, error: dbErr } = await repoRead(() => ctx.projects.findFull(id))
    if (dbErr) return dbErr
    return Response.json({ project: data })
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { ctx, user, error } = await new ApiContext().requireUser()
    if (error) return error
    // Renaming/reconfiguring a project is an admin action within its team.
    const access = await ctx.access.canAccessProject(user.id, id)
    if (!access.ok) return Response.json({ project: null })
    if (!Role.of(access.role).atLeast("admin")) return forbidden("only team admins can edit a project")

    let body: Record<string, unknown>
    try { body = await request.json() } catch { return jsonError("bad_request", "invalid JSON", 400) }

    const allowed: ProjectPatch = {}
    if (typeof body.name === "string") allowed.name = body.name.trim()
    if (typeof body.description === "string") allowed.description = body.description
    if (typeof body.repo_url === "string") allowed.repo_url = body.repo_url.trim()
    // Project settings (setup page). Add new toggles here as settings grow.
    if (typeof body.auto_index_on_push === "boolean") allowed.auto_index_on_push = body.auto_index_on_push
    // Duplicate sensitivity: reject an unknown level rather than silently
    // coercing it to the default. The parser degrades for READS (a column this
    // code doesn't recognise shouldn't 500 every lookup), but a write is someone
    // asking for something specific, and quietly storing 'medium' instead would
    // read as the setting not sticking.
    if ("duplicate_sensitivity" in body) {
        const level = body.duplicate_sensitivity
        if (typeof level !== "string" || !(DUPLICATE_SENSITIVITIES as readonly string[]).includes(level)) {
            return jsonError("bad_request", `duplicate_sensitivity must be one of ${DUPLICATE_SENSITIVITIES.join(", ")}`, 400)
        }
        allowed.duplicate_sensitivity = level
    }
    // Icon: a canonical Iconly slug, or null to reset to the hash-derived glyph.
    if ("icon_name" in body) {
        if (body.icon_name === null) allowed.icon_name = null
        else if (typeof body.icon_name === "string" && isKnownIconName(body.icon_name.trim()))
            allowed.icon_name = body.icon_name.trim()
        else return jsonError("bad_request", "unknown icon_name", 400)
    }
    if (Object.keys(allowed).length === 0) return jsonError("bad_request", "no fields to update", 400)

    const { data, error: dbErr } = await repoRead(() => ctx.projects.update(id, allowed))
    if (dbErr) return dbErr
    return Response.json({ project: data })
}

// DELETE /api/projects/[id] — delete a project and EVERYTHING about it: the
// analyser's knowledge graph (external service) and all tracker records.
//
// Order matters:
//   1. Capture the analyser graph_id before deleting the project — the delete
//      cascades project_analyser away, taking graph_id with it.
//   2. Delete the project via ProjectDeletionService. The database no longer
//      cascades into the regional tables — issues, comments, the PR mirror,
//      embeddings and chat context lost their FK to `projects` when the planes
//      split — so the service clears those first, then the central suggestions
//      pointing at the removed issues, then the row itself (whose cascade still
//      clears every CENTRAL child). Hard-fail: if it errors we stop and touch
//      nothing external, leaving a project you can see and retry rather than
//      orphans you cannot find.
//   3. Best-effort external cleanup with the captured graph_id: tear down the
//      analyser graph and delete pr_review_index rows (keyed by repo_id text,
//      NOT a project FK, so they don't cascade; service-role write only). A
//      failure here is logged, not surfaced — the project is already gone and
//      the user shouldn't be blocked by an unreachable analyser.
export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    // requireProjectAccess, NOT requireUser: this route purges the project's
    // REGIONAL content, and only a guard that binds a region may touch the data
    // plane. The bare-requireUser version type-checked and threw on every call —
    // an unbound data plane is fail-closed by design.
    const { ctx, role, error } = await new ApiContext().requireProjectAccess(id)
    if (error) return error
    // Deleting a project (and its knowledge graph) is an admin action.
    if (!Role.of(role).atLeast("admin")) return forbidden("only team admins can delete a project")

    // Fail-safe: a query error folds to null → skip the (best-effort) graph
    // teardown, exactly as the old inline read (which ignored the error) did.
    const graphId = await tryOrNull(() => ctx.analyser.findGraphId(id))
    // The guard already resolved the placement, so take it from the context
    // rather than re-reading `projects` — which also has to happen BEFORE the row
    // is deleted, or the graph is stranded in its cell forever. A team with no
    // recorded placement binds central, so this answers "home", where the old
    // read answered null and orphaned the graph.
    const cell = ctx.cell

    // Not ctx.projects.delete: that removes the row and its CENTRAL children,
    // leaving every regional issue, comment and PR behind with nothing left to
    // find them by. See ProjectDeletionService.
    const { error: dbErr } = await repoRead(() => ctx.projectDeletion.delete(id))
    if (dbErr) return dbErr

    if (graphId) {
        // Only the graph teardown is cell-bound; the pr_review_index cleanup
        // below lives in the tracker DB and must run either way.
        if (cell) {
            try {
                await getAnalyser(cell).deleteGraph(graphId)
            } catch (e) {
                console.error("[project delete] analyser graph teardown failed", id, graphId, e)
            }
        } else {
            // Loud on purpose: the project row is already gone, so nothing will
            // ever resolve this graph's cell again. It needs manual teardown.
            console.error("[project delete] unknown cell — graph orphaned, delete it manually", id, graphId)
        }
        try {
            // The CELL's database, not the control one.
            //
            // pr_review_index is written by the ANALYSER, which uses its own
            // Supabase configuration — the cell's data plane. This delete used
            // Supabase.service() on the stated belief that the table "lives in
            // the tracker DB", and for a project bound to a cell that is simply
            // the wrong database: the delete succeeds, removes nothing, and the
            // rows outlive the project with no way left to find them.
            //
            // dataClientForCell(null) IS the control client, so a home-cell
            // project behaves exactly as before.
            const regional = dataClientForCell(cell)
            const { error: prErr } = await regional.from("pr_review_index").delete().eq("repo_id", graphId)
            if (prErr) console.error("[project delete] pr_review_index cleanup failed", id, graphId, prErr.message)
        } catch (e) {
            console.error("[project delete] pr_review_index cleanup threw", id, graphId, e)
        }
    }

    return new Response(null, { status: 204 })
}
