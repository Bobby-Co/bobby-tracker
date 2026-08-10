// Gate for the comment-authoring routes (PR + issue): verifies the caller owns
// the project (RLS via the user-scoped read), resolves owner/repo, and fetches
// the caller's personal GitHub token so we post AS THEM. Returns a ready-to-send
// Response on any failed gate.

import { jsonError } from "@/lib/server/http/api"
import { createGithubTokenRepository } from "./GithubTokenRepository"
import { createProviderTokenRepository } from "./ProviderTokenRepository"
import { RepoRef } from "../domain/RepoRef"
import { getVcsUserService } from "../Composition"
import type { VcsUserService } from "../application/VcsUserService"
import { createSupabaseProjectsRepository } from "@/modules/projects"
import { RepositoryError } from "@/lib/shared/kernel"
import type { SupabaseRlsClient } from "@/lib/server/supabase"

type SupabaseServer = SupabaseRlsClient

// The comment-authoring actor: a VcsUserService already bound to the project's
// repo + the caller's personal token, plus the login for provenance display.
export type CommentActor = { vcs: VcsUserService; login: string | null }

export class CommentActions {
    async resolve(
        supabase: SupabaseServer,
        userId: string,
        projectId: string,
    ): Promise<CommentActor | { error: Response }> {
        // Read the project's sync context (provider + repo + gitlab linkage).
        const projects = createSupabaseProjectsRepository(supabase)
        let project: Awaited<ReturnType<typeof projects.findGithubSyncContext>>
        try {
            project = await projects.findGithubSyncContext(projectId)
        } catch (e) {
            if (e instanceof RepositoryError) return { error: jsonError("db_error", e.message, 500) }
            throw e
        }
        if (!project) return { error: jsonError("not_found", "project not found", 404) }
        if (!RepoRef.of(project).fullName()) {
            return { error: jsonError("not_linked", "this project isn't linked to a repository", 400) }
        }

        // GitLab: comment as the user with their per-instance token.
        if (project.provider === "gitlab") {
            if (!project.gitlab_host) return { error: jsonError("bad_request", "gitlab project missing host", 400) }
            const tok = await createProviderTokenRepository(supabase).find(userId, project.gitlab_host)
            if (!tok) return { error: jsonError("gitlab_reauth_required", `Connect ${project.gitlab_host} to comment.`, 401) }
            const vcs = getVcsUserService(project, tok.accessToken)!
            return { vcs, login: tok.login }
        }

        // GitHub: comment as the user with their personal token.
        const gh = await createGithubTokenRepository(supabase).find(userId)
        if (!gh) return { error: jsonError("github_reauth_required", "Connect GitHub to comment.", 401) }
        const vcs = getVcsUserService(project, gh.token)!
        return { vcs, login: gh.login }
    }
}
