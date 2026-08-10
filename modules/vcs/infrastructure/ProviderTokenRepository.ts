// VCS infrastructure — read/write the signed-in user's per-provider OAuth token
// from tracker.provider_tokens (migration 0055). This is the multi-provider
// sibling of GithubTokenRepository: GitHub keeps its own github_tokens table for
// now, while GitLab (and any future provider) lives here, keyed (user_id,
// provider) so a user can connect more than one. Unlike GitHub's classic token,
// these expire and carry a refresh token — callers refresh lazily on read/401.

import { RepositoryError } from "@/lib/shared/kernel"
import type { SupabaseRlsClient } from "@/lib/server/supabase"

/** A VCS provider that stores its user token in provider_tokens. GitHub is
 *  deliberately excluded — it still uses github_tokens (GithubTokenRepository). */
export type ProviderTokenProvider = "gitlab"

/** The caller's stored OAuth credential for one provider. */
export interface UserProviderToken {
    accessToken: string
    refreshToken: string | null
    expiresAt: string | null
    scopes: string | null
    login: string | null
}

/** What the auth callback persists after an OAuth grant. */
export interface ProviderTokenUpsert {
    accessToken: string
    refreshToken: string | null
    expiresAt: string | null
    scopes: string | null
    providerUserId: string | null
    login: string | null
}

/** Reads/writes the caller's per-provider VCS credential. A port so the
 *  connection route + repo-listing depend on the interface, not the table. */
export interface ProviderTokenRepository {
    /** The user's token for `provider`, or null when they haven't connected it.
     *  THROWS RepositoryError on a query failure. */
    find(userId: string, provider: ProviderTokenProvider): Promise<UserProviderToken | null>

    /** Upsert the user's token for `provider` (called from the OAuth callback). */
    upsert(userId: string, provider: ProviderTokenProvider, token: ProviderTokenUpsert): Promise<void>

    /** Delete the user's token for `provider` (the "disconnect" action). Idempotent. */
    remove(userId: string, provider: ProviderTokenProvider): Promise<void>
}

interface ProviderTokenRow {
    access_token: string
    refresh_token: string | null
    expires_at: string | null
    scopes: string | null
    provider_login: string | null
}

/** The Supabase adapter, bound to a request's client. Construct via the factory. */
export class SupabaseProviderTokenRepository implements ProviderTokenRepository {
    constructor(private readonly db: SupabaseRlsClient) {}

    async find(userId: string, provider: ProviderTokenProvider): Promise<UserProviderToken | null> {
        const { data, error } = await this.db
            .from("provider_tokens")
            .select("access_token,refresh_token,expires_at,scopes,provider_login")
            .eq("user_id", userId)
            .eq("provider", provider)
            .maybeSingle<ProviderTokenRow>()
        if (error) throw new RepositoryError(error.message, { cause: error })
        if (!data?.access_token) return null
        return {
            accessToken: data.access_token,
            refreshToken: data.refresh_token ?? null,
            expiresAt: data.expires_at ?? null,
            scopes: data.scopes ?? null,
            login: data.provider_login ?? null,
        }
    }

    async upsert(
        userId: string,
        provider: ProviderTokenProvider,
        token: ProviderTokenUpsert,
    ): Promise<void> {
        const { error } = await this.db.from("provider_tokens").upsert(
            {
                user_id: userId,
                provider,
                access_token: token.accessToken,
                refresh_token: token.refreshToken,
                expires_at: token.expiresAt,
                scopes: token.scopes,
                provider_user_id: token.providerUserId,
                provider_login: token.login,
            },
            { onConflict: "user_id,provider" },
        )
        if (error) throw new RepositoryError(error.message, { cause: error })
    }

    async remove(userId: string, provider: ProviderTokenProvider): Promise<void> {
        const { error } = await this.db
            .from("provider_tokens")
            .delete()
            .eq("user_id", userId)
            .eq("provider", provider)
        if (error) throw new RepositoryError(error.message, { cause: error })
    }
}

/** Composition seam: bind a ProviderTokenRepository to a request's Supabase client. */
export function createProviderTokenRepository(db: SupabaseRlsClient): ProviderTokenRepository {
    return new SupabaseProviderTokenRepository(db)
}
