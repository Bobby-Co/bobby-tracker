// MCP OAuth bounded context — PUBLIC CONTRACT (see modules/README.md).
//
// A self-contained OAuth 2.1 Authorization Server so Claude (Claude Code /
// Desktop / claude.ai) can authorize against the remote MCP server this app hosts
// at /api/mcp. Authorization Server and Resource Server are the same origin, so
// tokens are OPAQUE and validation is a DB lookup — see domain/OpaqueSecret.
//
// The interface layer is the Next host:
//   GET  /.well-known/oauth-authorization-server        RFC 8414 metadata
//   GET  /.well-known/oauth-protected-resource[/api/mcp] RFC 9728 metadata
//   POST /api/oauth/register                            RFC 7591 registration
//   GET  /oauth/authorize                               authorization endpoint —
//                                                       a ROUTE HANDLER, so the
//                                                       signed-out bounce to
//                                                       /login is a real HTTP
//                                                       redirect that keeps the
//                                                       query string intact
//   GET  /oauth/consent                                 the human consent screen
//   POST /api/oauth/authorize                           the consent decision
//   POST /api/oauth/token                               code exchange + refresh
//   POST /api/oauth/revoke                              RFC 7009 revocation

// ─── the resource server's entry point ──────────────────────────────────────
export type { McpTokenClaims } from "./ports/OAuthTypes"
export { resolveAccessToken } from "./Composition"

// ─── the authorization/token/registration use cases (composition seams) ─────
export { getOAuthAuthorizationService, getOAuthClientService, getOAuthTokenService, getOAuthTokenRepository } from "./Composition"
export type { OAuthAuthorizationService, DescribeResult } from "./application/OAuthAuthorizationService"
export type { OAuthClientService, RegistrationRequest, RegisteredClient } from "./application/OAuthClientService"
export type {
    OAuthTokenService,
    CodeExchangeRequest,
    RefreshRequest,
    ClientCredentials,
} from "./application/OAuthTokenService"

// ─── protocol values + policy (pure domain) ─────────────────────────────────
export { MCP_SCOPE, AuthorizationRequest } from "./domain/AuthorizationRequest"
export type { AuthorizeFault, AuthorizeQuery, ConsentingClient } from "./domain/AuthorizationRequest"
export { OAuthError } from "./domain/OAuthError"
export { ConsentCsrf } from "./domain/ConsentCsrf"
export { OpaqueSecret } from "./domain/OpaqueSecret"
export { Pkce } from "./domain/Pkce"
export { RedirectUris } from "./domain/RedirectUris"

// ─── server identity (issuer / endpoints / canonical resource) ──────────────
export { OAuthServerConfig } from "./infrastructure/OAuthServerConfig"
export { ConsentSessionSecret } from "./infrastructure/ConsentSessionSecret"

// ─── HTTP plumbing for the route handlers (CORS / cache / error envelope) ───
export { corsPreflight, credentialJson, discoveryJson, oauthErrorJson } from "./infrastructure/OAuthHttp"

// ─── wire types + lifetimes ─────────────────────────────────────────────────
export type {
    IssuedTokens,
    NewOAuthClient,
    NewOAuthCode,
    NewOAuthToken,
    OAuthClientRecord,
    OAuthCodeRecord,
    OAuthConnection,
    OAuthTokenRecord,
    TokenEndpointAuthMethod,
} from "./ports/OAuthTypes"
export {
    ACCESS_TOKEN_TTL_SECONDS,
    AUTHORIZATION_CODE_TTL_SECONDS,
    REFRESH_TOKEN_TTL_SECONDS,
} from "./ports/OAuthTypes"

// ─── persistence ports + Supabase adapters ──────────────────────────────────
export type { OAuthClientRepository } from "./ports/OAuthClientRepository"
export type { OAuthCodeRepository } from "./ports/OAuthCodeRepository"
export type { OAuthTokenRepository } from "./ports/OAuthTokenRepository"
export { createSupabaseOAuthClientRepository } from "./infrastructure/SupabaseOAuthClientRepository"
export { createSupabaseOAuthCodeRepository } from "./infrastructure/SupabaseOAuthCodeRepository"
export { createSupabaseOAuthTokenRepository } from "./infrastructure/SupabaseOAuthTokenRepository"
