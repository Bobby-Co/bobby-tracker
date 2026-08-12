// mcp-oauth infrastructure — the Supabase adapter for OAuthTokenRepository. The
// only place that queries tracker.mcp_oauth_tokens.
//
// Service-role bound, so RLS is bypassed and the filters here ARE the security
// boundary. Two habits make that safe and both are deliberate:
//   • every lookup is keyed on a unique hash column, and a blank key returns
//     null instead of being handed to the query builder;
//   • every revoke names `user_id` / `client_id` / `code_hash` explicitly and
//     adds `.is("revoked_at", null)` so it can only ever narrow, never widen.
//
// `revoke` is conditional-with-select for the same reason `consume` is on codes:
// the row count tells the caller whether IT performed the revocation, which is
// how refresh-token reuse is detected.

import type { SupabaseClient } from "@supabase/supabase-js"
import { RepositoryError } from "@/lib/shared/kernel"
import type { OAuthTokenRepository } from "../ports/OAuthTokenRepository"
import type { NewOAuthToken, OAuthTokenRecord, OAuthConnection } from "../ports/OAuthTypes"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any, any, any>

interface TokenRow {
    id: string
    token_hash: string
    refresh_hash: string | null
    client_id: string
    user_id: string
    scope: string
    expires_at: string
    refresh_expires_at: string | null
    revoked_at: string | null
    last_used_at: string | null
    code_hash: string | null
}

export class SupabaseOAuthTokenRepository implements OAuthTokenRepository {
    constructor(private readonly db: AnyDb) {}

    async create(token: NewOAuthToken): Promise<void> {
        const { error } = await this.db.from("mcp_oauth_tokens").insert({
            token_hash: token.tokenHash,
            refresh_hash: token.refreshHash,
            client_id: token.clientId,
            user_id: token.userId,
            scope: token.scope,
            expires_at: token.expiresAt,
            refresh_expires_at: token.refreshExpiresAt,
            code_hash: token.codeHash,
        })
        if (error) throw new RepositoryError(error.message, { cause: error })
    }

    findByAccessHash(tokenHash: string): Promise<OAuthTokenRecord | null> {
        return this.findBy("token_hash", tokenHash)
    }

    findByRefreshHash(refreshHash: string): Promise<OAuthTokenRecord | null> {
        return this.findBy("refresh_hash", refreshHash)
    }

    async listConnectionsForUser(userId: string): Promise<OAuthConnection[]> {
        if (!userId) return []
        // The client name is embedded over the client_id FK. mcp_oauth_clients has
        // no user-facing policy, so this read only works service-role — which is
        // why `user_id` is pinned here rather than left to RLS.
        const { data, error } = await this.db
            .from("mcp_oauth_tokens")
            .select("id, client_id, scope, expires_at, last_used_at, created_at, mcp_oauth_clients(client_name)")
            .eq("user_id", userId)
            .is("revoked_at", null)
            .order("created_at", { ascending: false })
        if (error) throw new RepositoryError(error.message, { cause: error })

        type Joined = {
            id: string
            client_id: string
            scope: string
            expires_at: string
            last_used_at: string | null
            created_at: string
            // PostgREST returns the embed as an object, but falls back to an array
            // when it can't prove uniqueness — normalise both.
            mcp_oauth_clients: { client_name: string | null } | { client_name: string | null }[] | null
        }

        return ((data ?? []) as Joined[]).map((row) => {
            const client = Array.isArray(row.mcp_oauth_clients) ? row.mcp_oauth_clients[0] : row.mcp_oauth_clients
            return {
                id: row.id,
                clientId: row.client_id,
                clientName: client?.client_name || row.client_id,
                scope: row.scope,
                expiresAt: row.expires_at,
                lastUsedAt: row.last_used_at,
                createdAt: row.created_at,
            }
        })
    }

    async revokeForUser(id: string, userId: string): Promise<boolean> {
        if (!id || !userId) return false
        const { data, error } = await this.db
            .from("mcp_oauth_tokens")
            .update({ revoked_at: new Date().toISOString() })
            .eq("id", id)
            .eq("user_id", userId)
            .is("revoked_at", null)
            .select("id")
        if (error) throw new RepositoryError(error.message, { cause: error })
        return (data?.length ?? 0) === 1
    }

    async revoke(id: string): Promise<boolean> {
        if (!id) return false
        const { data, error } = await this.db
            .from("mcp_oauth_tokens")
            .update({ revoked_at: new Date().toISOString() })
            .eq("id", id)
            .is("revoked_at", null)
            .select("id")
        if (error) throw new RepositoryError(error.message, { cause: error })
        return (data?.length ?? 0) === 1
    }

    async revokeByCodeHash(codeHash: string): Promise<void> {
        if (!codeHash) return
        const { error } = await this.db
            .from("mcp_oauth_tokens")
            .update({ revoked_at: new Date().toISOString() })
            .eq("code_hash", codeHash)
            .is("revoked_at", null)
        if (error) throw new RepositoryError(error.message, { cause: error })
    }

    async revokeFamily(userId: string, clientId: string): Promise<void> {
        if (!userId || !clientId) return
        const { error } = await this.db
            .from("mcp_oauth_tokens")
            .update({ revoked_at: new Date().toISOString() })
            .eq("user_id", userId)
            .eq("client_id", clientId)
            .is("revoked_at", null)
        if (error) throw new RepositoryError(error.message, { cause: error })
    }

    async touchLastUsed(id: string): Promise<void> {
        if (!id) return
        // Contractually non-throwing: an audit stamp must never fail a valid MCP
        // call, so a failure here is dropped rather than propagated.
        try {
            await this.db.from("mcp_oauth_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", id)
        } catch {
            /* deliberately ignored */
        }
    }

    private async findBy(column: "token_hash" | "refresh_hash", value: string): Promise<OAuthTokenRecord | null> {
        if (!value) return null
        const { data, error } = await this.db.from("mcp_oauth_tokens").select("*").eq(column, value).maybeSingle()
        if (error) throw new RepositoryError(error.message, { cause: error })
        if (!data) return null
        const row = data as TokenRow
        return {
            id: row.id,
            tokenHash: row.token_hash,
            refreshHash: row.refresh_hash,
            clientId: row.client_id,
            userId: row.user_id,
            scope: row.scope,
            expiresAt: row.expires_at,
            refreshExpiresAt: row.refresh_expires_at,
            revokedAt: row.revoked_at,
            lastUsedAt: row.last_used_at,
            codeHash: row.code_hash,
        }
    }
}

/** Composition seam: bind an OAuthTokenRepository to a Supabase client. */
export function createSupabaseOAuthTokenRepository(db: AnyDb): OAuthTokenRepository {
    return new SupabaseOAuthTokenRepository(db)
}
