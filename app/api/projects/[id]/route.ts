import { createSupabaseProjectAnalyserRepository, getAnalyser } from "@/modules/analysis"
import { forbidden, jsonError, requireUser } from "@/lib/api"
import { tryOrNull } from "@/lib/kernel"
import { assertProjectAccess, roleAtLeast } from "@/lib/auth/team-access"
import { findIcon } from "@/lib/icons/iconly"
import { ICONLY_NAMES } from "@/lib/icons/iconly-catalog"
import { createServiceClient } from "@/lib/supabase/server"
import type { Project } from "@/lib/supabase/types"

// Same gate as the label-icons route: only slugs the renderer can actually draw
// (the 361-icon catalog, or a legacy path-based icon) are allowed to be stored.
function isKnownIconName(name: string): boolean {
    return ICONLY_NAMES.has(name) || !!findIcon(name)
}

// GET /api/projects/[id] — single project. Shape: { project: Project | null }.
// RLS blocks cross-team reads; assertProjectAccess adds the group-level gate so a
// plain member can't open a same-team project they weren't granted (returns 404,
// not 403, so we don't reveal the project exists).
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { supabase, user, error } = await requireUser()
    if (error) return error
    const access = await assertProjectAccess(supabase, user.id, id)
    if (!access.ok) return Response.json({ project: null })
    const { data, error: dbErr } = await supabase
        .from("projects")
        .select("*")
        .eq("id", id)
        .maybeSingle<Project>()
    if (dbErr) return jsonError("db_error", dbErr.message, 500)
    return Response.json({ project: data })
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { supabase, user, error } = await requireUser()
    if (error) return error
    // Renaming/reconfiguring a project is an admin action within its team.
    const access = await assertProjectAccess(supabase, user.id, id)
    if (!access.ok) return Response.json({ project: null })
    if (!roleAtLeast(access.role, "admin")) return forbidden("only team admins can edit a project")

    let body: Record<string, unknown>
    try { body = await request.json() } catch { return jsonError("bad_request", "invalid JSON", 400) }

    const allowed: Record<string, unknown> = {}
    if (typeof body.name === "string") allowed.name = body.name.trim()
    if (typeof body.description === "string") allowed.description = body.description
    if (typeof body.repo_url === "string") allowed.repo_url = body.repo_url.trim()
    // Project settings (setup page). Add new toggles here as settings grow.
    if (typeof body.auto_index_on_push === "boolean") allowed.auto_index_on_push = body.auto_index_on_push
    // Icon: a canonical Iconly slug, or null to reset to the hash-derived glyph.
    if ("icon_name" in body) {
        if (body.icon_name === null) allowed.icon_name = null
        else if (typeof body.icon_name === "string" && isKnownIconName(body.icon_name.trim()))
            allowed.icon_name = body.icon_name.trim()
        else return jsonError("bad_request", "unknown icon_name", 400)
    }
    if (Object.keys(allowed).length === 0) return jsonError("bad_request", "no fields to update", 400)

    const { data, error: dbErr } = await supabase
        .from("projects")
        .update(allowed)
        .eq("id", id)
        .select("*")
        .single<Project>()
    if (dbErr) return jsonError("db_error", dbErr.message, 500)
    return Response.json({ project: data })
}

// DELETE /api/projects/[id] — delete a project and EVERYTHING about it: the
// analyser's knowledge graph (external service) and all tracker records.
//
// Order matters:
//   1. Capture the analyser graph_id before deleting the project — the delete
//      cascades project_analyser away, taking graph_id with it.
//   2. Delete the project row (RLS scopes to owner). FK cascades wipe issues,
//      PRs, comments, analyser row, sessions, tags, mind context, etc. This is
//      the hard-fail step — if it errors we stop and touch nothing external.
//   3. Best-effort external cleanup with the captured graph_id: tear down the
//      analyser graph and delete pr_review_index rows (keyed by repo_id text,
//      NOT a project FK, so they don't cascade; service-role write only). A
//      failure here is logged, not surfaced — the project is already gone and
//      the user shouldn't be blocked by an unreachable analyser.
export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { supabase, user, error } = await requireUser()
    if (error) return error
    // Deleting a project (and its knowledge graph) is an admin action.
    const access = await assertProjectAccess(supabase, user.id, id)
    if (!access.ok) return Response.json({ project: null })
    if (!roleAtLeast(access.role, "admin")) return forbidden("only team admins can delete a project")

    // Fail-safe: a query error folds to null → skip the (best-effort) graph
    // teardown, exactly as the old inline read (which ignored the error) did.
    const graphId = await tryOrNull(() =>
        createSupabaseProjectAnalyserRepository(supabase).findGraphId(id),
    )

    const { error: dbErr } = await supabase.from("projects").delete().eq("id", id)
    if (dbErr) return jsonError("db_error", dbErr.message, 500)

    if (graphId) {
        try {
            await getAnalyser().deleteGraph(graphId)
        } catch (e) {
            console.error("[project delete] analyser graph teardown failed", id, graphId, e)
        }
        try {
            const svc = createServiceClient()
            const { error: prErr } = await svc.from("pr_review_index").delete().eq("repo_id", graphId)
            if (prErr) console.error("[project delete] pr_review_index cleanup failed", id, graphId, prErr.message)
        } catch (e) {
            console.error("[project delete] pr_review_index cleanup threw", id, graphId, e)
        }
    }

    return new Response(null, { status: 204 })
}
