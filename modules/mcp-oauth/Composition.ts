// mcp-oauth — composition root. The one place that decides WHICH store backs the
// OAuth services, and the only file in this module that names both a concrete
// adapter and the server-side Supabase seam.
//
// Every service here is bound to `Supabase.service()` (RLS bypassed) and that is
// a deliberate, load-bearing choice rather than convenience:
//
//   • the token, register and revoke endpoints are called by a CLI/desktop client
//     that has no browser session, so there is no `auth.uid()` for RLS to key on;
//   • the authorization code is minted for a user, but read back later by a
//     caller who is not yet authenticated as anyone;
//   • the resource server resolves a bearer token BEFORE it knows who the user is
//     — resolving it is how it finds out.
//
// The tables are correspondingly closed to `authenticated` (see migration 0061),
// and the adapters filter every query explicitly to compensate for the bypass.

import { Supabase } from "@/lib/server/supabase"
import { OAuthAuthorizationService } from "./application/OAuthAuthorizationService"
import { OAuthClientService } from "./application/OAuthClientService"
import { OAuthTokenService } from "./application/OAuthTokenService"
import { createSupabaseOAuthClientRepository } from "./infrastructure/SupabaseOAuthClientRepository"
import { createSupabaseOAuthCodeRepository } from "./infrastructure/SupabaseOAuthCodeRepository"
import { createSupabaseOAuthTokenRepository } from "./infrastructure/SupabaseOAuthTokenRepository"
import type { McpTokenClaims } from "./ports/OAuthTypes"
import type { OAuthTokenRepository } from "./ports/OAuthTokenRepository"

/** Dynamic Client Registration (RFC 7591). */
export function getOAuthClientService(): OAuthClientService {
    const db = Supabase.service()
    return new OAuthClientService(createSupabaseOAuthClientRepository(db))
}

/** The authorization endpoint's use cases (validate a request, mint a code). */
export function getOAuthAuthorizationService(): OAuthAuthorizationService {
    const db = Supabase.service()
    return new OAuthAuthorizationService(
        createSupabaseOAuthClientRepository(db),
        createSupabaseOAuthCodeRepository(db),
    )
}

/** The token endpoint's use cases (exchange, refresh, revoke, resolve). */
export function getOAuthTokenService(): OAuthTokenService {
    const db = Supabase.service()
    return new OAuthTokenService(
        createSupabaseOAuthClientRepository(db),
        createSupabaseOAuthCodeRepository(db),
        createSupabaseOAuthTokenRepository(db),
    )
}

/** The token store, for the "connected apps" management screen. The caller is an
 *  authenticated browser session, but the client-name join needs the service role
 *  (mcp_oauth_clients has no user-facing policy), so the repository pins `user_id`
 *  in every statement instead — see listConnectionsForUser / revokeForUser. */
export function getOAuthTokenRepository(): OAuthTokenRepository {
    return createSupabaseOAuthTokenRepository(Supabase.service())
}

/** Resolve a raw bearer token to its claims, or null if unknown/expired/revoked.
 *
 *  THE PUBLISHED ENTRY POINT for the MCP resource server: it is the whole of the
 *  "is this caller allowed in, and who are they?" question. Never throws — a
 *  garbage Authorization header is an ordinary outcome, so every failure mode
 *  (malformed, unknown, expired, revoked, store unavailable) returns null and the
 *  caller answers 401. */
export function resolveAccessToken(rawToken: string): Promise<McpTokenClaims | null> {
    return getOAuthTokenService().resolveAccessToken(rawToken)
}
