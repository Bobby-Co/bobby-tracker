// VCS infrastructure — read/write the signed-in user's GitLab OAuth/PAT tokens
// from tracker.provider_tokens (migration 0055). GitHub keeps its own
// github_tokens table (GithubTokenRepository); this is GitLab-only and,
// crucially, MULTI-INSTANCE: because this is a public service, one user can
// connect public gitlab.com (OAuth) AND their own self-managed instance(s)
// (a pasted PAT). Rows are therefore keyed by host, and `list` returns every
// instance a user has connected.

import { RepositoryError } from "@/lib/shared/kernel"
import type { SupabaseRlsClient } from "@/lib/server/supabase"

const PROVIDER = "gitlab"

export type ProviderAuthKind = "oauth" | "pat"

/** A GitLab instance the user has connected, for the connections list UI. */
export interface GitlabConnection {
    host: string
    login: string | null
    authKind: ProviderAuthKind
}

/** The full stored credential for one instance (for repo-listing / API calls). */
export interface UserProviderToken {
    host: string
    authKind: ProviderAuthKind
    accessToken: string
    refreshToken: string | null
    expiresAt: string | null
    scopes: string | null
    login: string | null
    apiBase: string | null
}

/** What a connect flow persists (OAuth callback or PAT-paste route). */
export interface ProviderTokenUpsert {
    authKind: ProviderAuthKind
    accessToken: string
    refreshToken: string | null
    expiresAt: string | null
    scopes: string | null
    providerUserId: string | null
    login: string | null
    apiBase: string | null
}

/** Reads/writes the caller's per-instance GitLab credentials. A port so the
 *  connections route + repo-listing depend on the interface, not the table. */
export interface ProviderTokenRepository {
    /** Every GitLab instance the user has connected (for the Settings list).
     *  THROWS RepositoryError on a query failure. */
    list(userId: string): Promise<GitlabConnection[]>

    /** Every connected instance WITH its credential (for repo-listing across all
     *  sources). Server-only; the tokens never leave the request. */
    all(userId: string): Promise<UserProviderToken[]>

    /** The full credential for one instance, or null when not connected. */
    find(userId: string, host: string): Promise<UserProviderToken | null>

    /** Upsert the user's credential for `host` (OAuth callback or PAT paste). */
    upsert(userId: string, host: string, token: ProviderTokenUpsert): Promise<void>

    /** Disconnect one instance. Idempotent. */
    remove(userId: string, host: string): Promise<void>
}

interface ProviderTokenRow {
    host: string
    auth_kind: ProviderAuthKind
    access_token: string
    refresh_token: string | null
    expires_at: string | null
    scopes: string | null
    provider_login: string | null
    api_base: string | null
}

/** The Supabase adapter, bound to a request's client. Construct via the factory. */
export class SupabaseProviderTokenRepository implements ProviderTokenRepository {
    constructor(private readonly db: SupabaseRlsClient) {}

    async list(userId: string): Promise<GitlabConnection[]> {
        const { data, error } = await this.db
            .from("provider_tokens")
            .select("host,auth_kind,provider_login")
            .eq("user_id", userId)
            .eq("provider", PROVIDER)
            .order("host", { ascending: true })
            .returns<Pick<ProviderTokenRow, "host" | "auth_kind" | "provider_login">[]>()
        if (error) throw new RepositoryError(error.message, { cause: error })
        return (data ?? []).map((r) => ({
            host: r.host,
            login: r.provider_login ?? null,
            authKind: r.auth_kind,
        }))
    }

    async all(userId: string): Promise<UserProviderToken[]> {
        const { data, error } = await this.db
            .from("provider_tokens")
            .select("host,auth_kind,access_token,refresh_token,expires_at,scopes,provider_login,api_base")
            .eq("user_id", userId)
            .eq("provider", PROVIDER)
            .order("host", { ascending: true })
            .returns<ProviderTokenRow[]>()
        if (error) throw new RepositoryError(error.message, { cause: error })
        return (data ?? [])
            .filter((r) => !!r.access_token)
            .map((r) => ({
                host: r.host,
                authKind: r.auth_kind,
                accessToken: r.access_token,
                refreshToken: r.refresh_token ?? null,
                expiresAt: r.expires_at ?? null,
                scopes: r.scopes ?? null,
                login: r.provider_login ?? null,
                apiBase: r.api_base ?? null,
            }))
    }

    async find(userId: string, host: string): Promise<UserProviderToken | null> {
        const { data, error } = await this.db
            .from("provider_tokens")
            .select("host,auth_kind,access_token,refresh_token,expires_at,scopes,provider_login,api_base")
            .eq("user_id", userId)
            .eq("provider", PROVIDER)
            .eq("host", host)
            .maybeSingle<ProviderTokenRow>()
        if (error) throw new RepositoryError(error.message, { cause: error })
        if (!data?.access_token) return null
        return {
            host: data.host,
            authKind: data.auth_kind,
            accessToken: data.access_token,
            refreshToken: data.refresh_token ?? null,
            expiresAt: data.expires_at ?? null,
            scopes: data.scopes ?? null,
            login: data.provider_login ?? null,
            apiBase: data.api_base ?? null,
        }
    }

    async upsert(userId: string, host: string, token: ProviderTokenUpsert): Promise<void> {
        const { error } = await this.db.from("provider_tokens").upsert(
            {
                user_id: userId,
                provider: PROVIDER,
                host,
                auth_kind: token.authKind,
                access_token: token.accessToken,
                refresh_token: token.refreshToken,
                expires_at: token.expiresAt,
                scopes: token.scopes,
                provider_user_id: token.providerUserId,
                provider_login: token.login,
                api_base: token.apiBase,
            },
            { onConflict: "user_id,provider,host" },
        )
        if (error) throw new RepositoryError(error.message, { cause: error })
    }

    async remove(userId: string, host: string): Promise<void> {
        const { error } = await this.db
            .from("provider_tokens")
            .delete()
            .eq("user_id", userId)
            .eq("provider", PROVIDER)
            .eq("host", host)
        if (error) throw new RepositoryError(error.message, { cause: error })
    }
}

/** Composition seam: bind a ProviderTokenRepository to a request's Supabase client. */
export function createProviderTokenRepository(db: SupabaseRlsClient): ProviderTokenRepository {
    return new SupabaseProviderTokenRepository(db)
}
