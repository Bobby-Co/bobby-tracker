import { after } from "next/server"
import { jsonError, repoRead, requireIssueAccess } from "@/lib/platform/http/api"
import { tryOrNull } from "@/lib/kernel"
import { deleteGithubIssueFromTracker, updateGithubIssueFromTracker } from "@/modules/github"
import { ISSUE_PRIORITIES, ISSUE_STATUSES } from "@/lib/supabase/types"
import type { Issue } from "@/lib/supabase/types"
import { createSupabaseProjectsRepository } from "@/modules/projects"
import { createSupabaseIssuesRepository } from "@/modules/issues"

// GET /api/issues/[id]?project_id=... — single issue. The optional
// project_id query param scopes the lookup to a project (matching the
// issue detail page's read). Shape: { issue: Issue | null }.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { supabase, error } = await requireIssueAccess(id)
    if (error) return error

    const projectId = new URL(request.url).searchParams.get("project_id")
    let query = supabase.from("issues").select("*").eq("id", id)
    if (projectId) query = query.eq("project_id", projectId)

    const { data, error: dbErr } = await query.maybeSingle<Issue>()
    if (dbErr) return jsonError("db_error", dbErr.message, 500)
    return Response.json({ issue: data })
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { supabase, error } = await requireIssueAccess(id)
    if (error) return error

    let body: Record<string, unknown>
    try { body = await request.json() } catch { return jsonError("bad_request", "invalid JSON", 400) }

    const patch: Record<string, unknown> = {}
    if (typeof body.title === "string" && body.title.trim()) patch.title = body.title.trim()
    if (typeof body.body === "string") patch.body = body.body
    if (typeof body.status === "string" && (ISSUE_STATUSES as readonly string[]).includes(body.status)) patch.status = body.status
    if (typeof body.priority === "string" && (ISSUE_PRIORITIES as readonly string[]).includes(body.priority)) patch.priority = body.priority
    if (Array.isArray(body.labels)) patch.labels = body.labels.filter((l: unknown) => typeof l === "string")
    if (Object.keys(patch).length === 0) return jsonError("bad_request", "no valid fields", 400)

    const { data, error: dbErr } = await supabase
        .from("issues")
        .update(patch)
        .eq("id", id)
        .select("*")
        .single<Issue>()
    if (dbErr) return jsonError("db_error", dbErr.message, 500)

    // Mirror title/body/status edits to GitHub when this issue is linked and
    // the project has two-way sync on. Only these three fields sync — never
    // priority/labels. Fire-and-forget via after() so the response isn't
    // blocked (bare `void` gets cancelled on Workers). No-op otherwise.
    const changed = {
        title: "title" in patch,
        body: "body" in patch,
        status: "status" in patch,
    }
    if (data?.github_issue_number && (changed.title || changed.body || changed.status)) {
        const project = await createSupabaseProjectsRepository(supabase).findGithubSyncContext(data.project_id)
        if (project?.github_sync_enabled && project.github_installation_id && project.github_repo_id) {
            after(() => updateGithubIssueFromTracker(data, project, changed))
        }
    }

    return Response.json({ issue: data })
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { supabase, error } = await requireIssueAccess(id)
    if (error) return error

    // Capture the row (esp. its GitHub linkage) BEFORE deleting so we can
    // propagate the deletion afterwards. Fail-safe: a read error → null → we
    // skip GitHub propagation, exactly as the old inline read did.
    const issue = await tryOrNull(() => createSupabaseIssuesRepository(supabase).findById(id))

    const { error: dbErr } = await repoRead(() => createSupabaseIssuesRepository(supabase).deleteById(id))
    if (dbErr) return dbErr

    // Propagate the delete to GitHub when the issue was linked and the project
    // opted into delete-sync (outbound). deleteGithubIssueFromTracker itself
    // re-checks direction + the deletes flag. Fire-and-forget via after().
    if (issue && (issue.github_issue_number != null || issue.github_node_id)) {
        const project = await createSupabaseProjectsRepository(supabase).findGithubSyncContext(issue.project_id)
        if (project) after(() => deleteGithubIssueFromTracker(issue, project))
    }

    return new Response(null, { status: 204 })
}
