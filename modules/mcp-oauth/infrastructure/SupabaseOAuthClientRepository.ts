// mcp-oauth infrastructure — the Supabase adapter for OAuthClientRepository. The
// only place that queries tracker.mcp_oauth_clients.
//
// Bound to the SERVICE-ROLE client: registration and the token endpoint both run
// with no auth cookie at all (a CLI/desktop client is calling), so there is no
// RLS identity to lean on. RLS being bypassed is exactly why every query below
// names its filter explicitly — `find` is keyed on client_id and nothing else,
// and a missing/blank id short-circuits rather than becoming an unfiltered read.

import type { SupabaseClient } from "@supabase/supabase-js"
import { RepositoryError } from "@/lib/shared/kernel"
import type { OAuthClientRepository } from "../ports/OAuthClientRepository"
import type { NewOAuthClient, OAuthClientRecord, TokenEndpointAuthMethod } from "../ports/OAuthTypes"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any, any, any>

interface ClientRow {
    client_id: string
    client_secret_hash: string | null
    client_name: string
    redirect_uris: string[]
    grant_types: string[] | null
    token_endpoint_auth_method: string
    client_uri: string | null
    created_at: string
}

export class SupabaseOAuthClientRepository implements OAuthClientRepository {
    constructor(private readonly db: AnyDb) {}

    async find(clientId: string): Promise<OAuthClientRecord | null> {
        // Guard: an empty id must never reach the query builder, where it would
        // become a filter that matches on the empty string rather than nothing.
        if (!clientId) return null

        const { data, error } = await this.db
            .from("mcp_oauth_clients")
            .select("*")
            .eq("client_id", clientId)
            .maybeSingle()
        if (error) throw new RepositoryError(error.message, { cause: error })
        return data ? toRecord(data as ClientRow) : null
    }

    async create(client: NewOAuthClient): Promise<OAuthClientRecord> {
        const { data, error } = await this.db
            .from("mcp_oauth_clients")
            .insert({
                client_id: client.clientId,
                client_secret_hash: client.clientSecretHash,
                client_name: client.clientName,
                redirect_uris: client.redirectUris,
                grant_types: client.grantTypes,
                token_endpoint_auth_method: client.tokenEndpointAuthMethod,
                client_uri: client.clientUri,
            })
            .select("*")
            .single()
        if (error) throw new RepositoryError(error.message, { cause: error })
        return toRecord(data as ClientRow)
    }
}

function toRecord(row: ClientRow): OAuthClientRecord {
    return {
        clientId: row.client_id,
        clientSecretHash: row.client_secret_hash,
        clientName: row.client_name,
        redirectUris: row.redirect_uris ?? [],
        grantTypes: row.grant_types ?? [],
        tokenEndpointAuthMethod: row.token_endpoint_auth_method as TokenEndpointAuthMethod,
        clientUri: row.client_uri,
        createdAt: row.created_at,
    }
}

/** Composition seam: bind an OAuthClientRepository to a Supabase client. */
export function createSupabaseOAuthClientRepository(db: AnyDb): OAuthClientRepository {
    return new SupabaseOAuthClientRepository(db)
}
