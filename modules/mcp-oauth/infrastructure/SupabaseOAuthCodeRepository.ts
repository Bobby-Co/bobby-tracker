// mcp-oauth infrastructure — the Supabase adapter for OAuthCodeRepository. The
// only place that queries tracker.mcp_oauth_codes. Service-role bound (the token
// endpoint has no cookie), so each query states its full filter.
//
// `consume` is the interesting one: it is a CONDITIONAL update
// (`set consumed_at = now() where code_hash = ? and consumed_at is null`) with
// `.select()`, so Postgres decides the winner under its own row lock and the
// returned row count tells us whether we were it. That is what makes single-use
// real rather than a read-then-write race two concurrent requests could both win.

import type { SupabaseClient } from "@supabase/supabase-js"
import { RepositoryError } from "@/lib/shared/kernel"
import type { OAuthCodeRepository } from "../ports/OAuthCodeRepository"
import type { NewOAuthCode, OAuthCodeRecord } from "../ports/OAuthTypes"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any, any, any>

interface CodeRow {
    code_hash: string
    client_id: string
    user_id: string
    redirect_uri: string
    code_challenge: string
    code_challenge_method: string
    scope: string
    resource: string | null
    expires_at: string
    consumed_at: string | null
}

export class SupabaseOAuthCodeRepository implements OAuthCodeRepository {
    constructor(private readonly db: AnyDb) {}

    async create(code: NewOAuthCode): Promise<void> {
        const { error } = await this.db.from("mcp_oauth_codes").insert({
            code_hash: code.codeHash,
            client_id: code.clientId,
            user_id: code.userId,
            redirect_uri: code.redirectUri,
            code_challenge: code.codeChallenge,
            code_challenge_method: "S256",
            scope: code.scope,
            resource: code.resource,
            expires_at: code.expiresAt,
        })
        if (error) throw new RepositoryError(error.message, { cause: error })
    }

    async find(codeHash: string): Promise<OAuthCodeRecord | null> {
        if (!codeHash) return null
        const { data, error } = await this.db
            .from("mcp_oauth_codes")
            .select("*")
            .eq("code_hash", codeHash)
            .maybeSingle()
        if (error) throw new RepositoryError(error.message, { cause: error })
        if (!data) return null
        const row = data as CodeRow
        return {
            codeHash: row.code_hash,
            clientId: row.client_id,
            userId: row.user_id,
            redirectUri: row.redirect_uri,
            codeChallenge: row.code_challenge,
            codeChallengeMethod: row.code_challenge_method,
            scope: row.scope,
            resource: row.resource,
            expiresAt: row.expires_at,
            consumedAt: row.consumed_at,
        }
    }

    async consume(codeHash: string): Promise<boolean> {
        if (!codeHash) return false
        const { data, error } = await this.db
            .from("mcp_oauth_codes")
            .update({ consumed_at: new Date().toISOString() })
            .eq("code_hash", codeHash)
            .is("consumed_at", null)
            .select("code_hash")
        if (error) throw new RepositoryError(error.message, { cause: error })
        return (data?.length ?? 0) === 1
    }
}

/** Composition seam: bind an OAuthCodeRepository to a Supabase client. */
export function createSupabaseOAuthCodeRepository(db: AnyDb): OAuthCodeRepository {
    return new SupabaseOAuthCodeRepository(db)
}
