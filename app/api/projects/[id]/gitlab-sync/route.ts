import { ApiContext, jsonError } from "@/lib/server/http/api"
import { provisionGitlabProject } from "@/modules/vcs"

// POST /api/projects/[id]/gitlab-sync — (re)provision a GitLab project's bot
// credential + webhook and enable sync. Runs automatically at project creation;
// this route is the retry path (the setup wizard's "Set up GitLab sync" button),
// so a project whose first provisioning failed (token not yet connected, a
// transient error) can be wired without recreating it.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { ctx, user, error } = await new ApiContext().requireProjectAccess(id)
    if (error) return error

    const project = await ctx.projects.findGithubSyncContext(id)
    if (!project) return jsonError("not_found", "project not found", 404)
    if (project.provider !== "gitlab" || project.gitlab_project_id == null || !project.gitlab_host) {
        return jsonError("bad_request", "not a GitLab project", 400)
    }

    const tok = await ctx.providerTokens.find(user.id, project.gitlab_host)
    if (!tok) {
        return jsonError("gitlab_reauth_required", `Connect ${project.gitlab_host} in Settings first.`, 401)
    }
    const apiBase = tok.apiBase ?? `https://${project.gitlab_host}/api/v4`

    let result
    try {
        result = await provisionGitlabProject({
            projectUuid: id,
            gitlabProjectId: project.gitlab_project_id,
            apiBase,
            userToken: tok.accessToken,
            webhookUrl: `${new URL(request.url).origin}/api/webhooks/gitlab`,
        })
    } catch (e) {
        return jsonError("gitlab_error", (e as Error).message, 502)
    }

    try {
        await ctx.projects.updateSyncSettings(id, { github_sync_enabled: true, github_sync_direction: "both" })
    } catch (e) {
        return jsonError("db_error", (e as Error).message, 500)
    }
    return Response.json({ ...result })
}
