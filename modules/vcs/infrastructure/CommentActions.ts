// Gate for the comment-authoring routes (PR + issue): verifies the caller owns
// the project (RLS via the user-scoped read), resolves owner/repo, and fetches
// the caller's personal GitHub token so we post AS THEM. Returns a ready-to-send
// Response on any failed gate.

import { jsonError } from "@/lib/server/http/api"
import { createGithubTokenRepository } from "./GithubTokenRepository"
import { RepoRef } from "../domain/RepoRef"
import { getVcsUserService } from "../Composition"
import type { VcsUserService } from "../application/VcsUserService"
import { createSupabaseProjectsRepository } from "@/modules/projects"
import { RepositoryError } from "@/lib/shared/kernel"
import type { createClient } from "@/lib/server/supabase"

type SupabaseServer = Awaited<ReturnType<typeof createClient>>

// The comment-authoring actor: a VcsUserService already bound to the project's
// repo + the caller's personal token, plus the login for provenance display.
export type CommentActor = { vcs: VcsUserService; login: string | null }

export class CommentActions {
    async resolve(
        supabase: SupabaseServer,
        userId: string,
        projectId: string,
    ): Promise<CommentActor | { error: Response }> {
        // Read the project through the Projects contract. findRepoRef throws on a
        // genuine DB error so we keep the 500-vs-404 distinction.
        const projects = createSupabaseProjectsRepository(supabase)
        let project: Awaited<ReturnType<typeof projects.findRepoRef>>
        try {
            project = await projects.findRepoRef(projectId)
        } catch (e) {
            if (e instanceof RepositoryError) return { error: jsonError("db_error", e.message, 500) }
            throw e
        }
        if (!project) return { error: jsonError("not_found", "project not found", 404) }
        if (!RepoRef.of(project).fullName()) {
            return { error: jsonError("not_github", "this project isn't linked to a GitHub repo", 400) }
        }

        const gh = await createGithubTokenRepository(supabase).find(userId)
        if (!gh) return { error: jsonError("github_reauth_required", "Connect GitHub to comment.", 401) }

        // fullName resolved above → the user service is non-null.
        const vcs = getVcsUserService(project, gh.token)!
        return { vcs, login: gh.login }
    }
}
