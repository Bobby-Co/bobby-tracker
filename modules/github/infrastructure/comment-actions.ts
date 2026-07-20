// Shared gate for the comment-authoring routes (PR + issue). Verifies the caller
// owns the project (RLS via the user-scoped read), resolves owner/repo, and
// fetches the caller's personal GitHub token so we can post AS THEM. Returns a
// ready-to-send Response on any failed gate.

import { jsonError } from "@/lib/platform/http/api"
import { getUserGithubToken } from "./github-user"
import { repoFullName } from "../domain/repo-ref"
import { createSupabaseProjectsRepository } from "@/modules/projects"
import { RepositoryError } from "@/lib/kernel"
import type { createClient } from "@/lib/supabase/server"

type SupabaseServer = Awaited<ReturnType<typeof createClient>>

export type CommentContext = { owner: string; repo: string; token: string; login: string | null }

export async function resolveCommentContext(
    supabase: SupabaseServer,
    userId: string,
    projectId: string,
): Promise<CommentContext | { error: Response }> {
    // Read the project through the Projects contract — github doesn't own the
    // projects table. findRepoRef throws on a genuine DB error so we keep the
    // 500-vs-404 distinction the gate relied on.
    const projects = createSupabaseProjectsRepository(supabase)
    let project: Awaited<ReturnType<typeof projects.findRepoRef>>
    try {
        project = await projects.findRepoRef(projectId)
    } catch (e) {
        if (e instanceof RepositoryError) return { error: jsonError("db_error", e.message, 500) }
        throw e
    }
    if (!project) return { error: jsonError("not_found", "project not found", 404) }

    const full = repoFullName(project)
    if (!full) return { error: jsonError("not_github", "this project isn't linked to a GitHub repo", 400) }
    const [owner, repo] = full.split("/")

    const gh = await getUserGithubToken(supabase, userId)
    if (!gh) return { error: jsonError("github_reauth_required", "Connect GitHub to comment.", 401) }

    return { owner, repo, token: gh.token, login: gh.login }
}
