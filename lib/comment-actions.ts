// Shared gate for the comment-authoring routes (PR + issue). Verifies the caller
// owns the project (RLS via the user-scoped read), resolves owner/repo, and
// fetches the caller's personal GitHub token so we can post AS THEM. Returns a
// ready-to-send Response on any failed gate.

import { jsonError } from "@/lib/api"
import { getUserGithubToken } from "@/lib/github-user"
import { repoFullName } from "@/lib/integrations/github"
import type { createClient } from "@/lib/supabase/server"

type SupabaseServer = Awaited<ReturnType<typeof createClient>>

export type CommentContext = { owner: string; repo: string; token: string; login: string | null }

export async function resolveCommentContext(
    supabase: SupabaseServer,
    userId: string,
    projectId: string,
): Promise<CommentContext | { error: Response }> {
    const { data: project, error } = await supabase
        .from("projects")
        .select("id,repo_url,repo_full_name")
        .eq("id", projectId)
        .maybeSingle<{ id: string; repo_url: string; repo_full_name: string | null }>()
    if (error) return { error: jsonError("db_error", error.message, 500) }
    if (!project) return { error: jsonError("not_found", "project not found", 404) }

    const full = repoFullName(project)
    if (!full) return { error: jsonError("not_github", "this project isn't linked to a GitHub repo", 400) }
    const [owner, repo] = full.split("/")

    const gh = await getUserGithubToken(supabase, userId)
    if (!gh) return { error: jsonError("github_reauth_required", "Connect GitHub to comment.", 401) }

    return { owner, repo, token: gh.token, login: gh.login }
}
