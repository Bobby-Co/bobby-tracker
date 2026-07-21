// VCS infrastructure — read the signed-in user's personal GitHub token. This is
// the credential the user-authority path posts comments with (bound into a
// VCSUserInstance by the comment gate) and the /github/connection route reports
// on. The same token + `repo`-scope gate that /api/github/repos uses
// (tracker.github_tokens, migration 0031).

import type { createClient } from "@/lib/supabase/server"
import type { GithubToken } from "@/lib/supabase/types"

type SupabaseServer = Awaited<ReturnType<typeof createClient>>

export type UserGithub = { token: string; login: string | null }

/** Reads the caller's personal VCS credential. A port so the comment gate + the
 *  connection route depend on the interface, not the Supabase table. */
export interface GithubTokenRepository {
    /** The user's personal token + login, or null when they haven't connected
     *  GitHub with the `repo` scope (same policy as the repos route). */
    find(userId: string): Promise<UserGithub | null>
}

/** The Supabase adapter, bound to a request's client. Construct via the factory. */
export class SupabaseGithubTokenRepository implements GithubTokenRepository {
    constructor(private readonly db: SupabaseServer) {}

    async find(userId: string): Promise<UserGithub | null> {
        const { data } = await this.db
            .from("github_tokens")
            .select("access_token,scopes,provider_login")
            .eq("user_id", userId)
            .maybeSingle<Pick<GithubToken, "access_token" | "scopes" | "provider_login">>()
        if (!data?.access_token) return null
        if (data.scopes && !data.scopes.split(/[,\s]+/).includes("repo")) return null
        return { token: data.access_token, login: data.provider_login ?? null }
    }
}

/** Composition seam: bind a GithubTokenRepository to a request's Supabase client. */
export function createGithubTokenRepository(db: SupabaseServer): GithubTokenRepository {
    return new SupabaseGithubTokenRepository(db)
}
