// VCS infrastructure — read the signed-in user's personal GitHub token. This is
// the credential the user-authority path posts comments with (bound into a
// VCSUserInstance by the comment gate) and the /github/connection route reports
// on. The same token + `repo`-scope gate that /api/github/repos uses
// (tracker.github_tokens, migration 0031).

import type { createClient } from "@/lib/supabase/server"
import type { GithubToken } from "@/lib/supabase/types"

type SupabaseServer = Awaited<ReturnType<typeof createClient>>

export type UserGithub = { token: string; login: string | null }

/** The user's personal token + login, or null when they haven't connected GitHub
 *  with the `repo` scope (same policy as the repos route). */
export async function getUserGithubToken(supabase: SupabaseServer, userId: string): Promise<UserGithub | null> {
    const { data } = await supabase
        .from("github_tokens")
        .select("access_token,scopes,provider_login")
        .eq("user_id", userId)
        .maybeSingle<Pick<GithubToken, "access_token" | "scopes" | "provider_login">>()
    if (!data?.access_token) return null
    if (data.scopes && !data.scopes.split(/[,\s]+/).includes("repo")) return null
    return { token: data.access_token, login: data.provider_login ?? null }
}
