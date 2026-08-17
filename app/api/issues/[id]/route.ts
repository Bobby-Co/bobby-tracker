import { after } from "next/server"
import { ApiContext, jsonError, repoRead } from "@/lib/server/http/api"
import { tryOrNull } from "@/lib/shared/kernel"
import { getVcsAppService } from "@/modules/vcs"
import { ISSUE_PRIORITIES, ISSUE_STATUSES } from "@/lib/shared/types"
import type { IssuePatch } from "@/modules/issues"

// GET /api/issues/[id]?project_id=... — single issue. The optional
// project_id query param scopes the lookup to a project (matching the
// issue detail page's read). Shape: { issue: Issue | null }.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { ctx, error } = await new ApiContext().requireIssueAccess(id)
    if (error) return error

    const issues = ctx.issues
    const projectId = new URL(request.url).searchParams.get("project_id")
    const { data, error: dbErr } = await repoRead(() => issues.findByIdInProject(id, projectId))
    if (dbErr) return dbErr
    return Response.json({ issue: data })
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { ctx, error } = await new ApiContext().requireIssueAccess(id)
    if (error) return error

    const issues = ctx.issues
    const projects = ctx.projects

    let body: Record<string, unknown>
    try { body = await request.json() } catch { return jsonError("bad_request", "invalid JSON", 400) }

    const patch: IssuePatch = {}
    if (typeof body.title === "string" && body.title.trim()) patch.title = body.title.trim()
    if (typeof body.body === "string") patch.body = body.body
    if (typeof body.status === "string" && (ISSUE_STATUSES as readonly string[]).includes(body.status)) patch.status = body.status as IssuePatch["status"]
    if (typeof body.priority === "string" && (ISSUE_PRIORITIES as readonly string[]).includes(body.priority)) patch.priority = body.priority as IssuePatch["priority"]
    if (Array.isArray(body.labels)) patch.labels = body.labels.filter((l: unknown): l is string => typeof l === "string")
    if (Object.keys(patch).length === 0) return jsonError("bad_request", "no valid fields", 400)

    const { data, error: dbErr } = await repoRead(() => issues.update(id, patch))
    if (dbErr) return dbErr

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
        const project = await projects.findGithubSyncContext(data.project_id)
        if (project?.github_sync_enabled && project.github_installation_id && project.github_repo_id) {
            after(() => getVcsAppService(project)?.syncIssueUpdated(data, project, changed))
        }
    }

    return Response.json({ issue: data })
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { ctx, error } = await new ApiContext().requireIssueAccess(id)
    if (error) return error

    // Capture the row (esp. its GitHub linkage) BEFORE deleting so we can
    // propagate the deletion afterwards. Fail-safe: a read error → null → we
    // skip GitHub propagation, exactly as the old inline read did.
    const issues = ctx.issues
    const projects = ctx.projects
    const issue = await tryOrNull(() => issues.findById(id))

    const { error: dbErr } = await repoRead(() => issues.deleteById(id))
    if (dbErr) return dbErr

    // Propagate the delete to GitHub when the issue was linked and the project
    // opted into delete-sync (outbound). deleteGithubIssueFromTracker itself
    // re-checks direction + the deletes flag. Fire-and-forget via after().
    if (issue && (issue.github_issue_number != null || issue.github_node_id)) {
        const project = await projects.findGithubSyncContext(issue.project_id)
        if (project) after(() => getVcsAppService(project)?.syncIssueDeleted(issue, project))
    }

    return new Response(null, { status: 204 })
}