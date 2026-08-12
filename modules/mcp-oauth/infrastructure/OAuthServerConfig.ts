// The Authorization Server's own identity: issuer, endpoints, and the canonical
// resource the MCP server is published under.
//
// The issuer is `NEXT_PUBLIC_APP_URL` and nothing else. It is NOT derived from
// the inbound Host/Origin header on purpose — every discovery document, every
// `iss` parameter (RFC 9207) and every resource identifier would otherwise follow
// whatever host an attacker put in the request, which is how AS-mixup and
// discovery-poisoning attacks start. A single operator-configured value keeps all
// of them pinned to the real deployment.

/** Trailing slashes are stripped so `${issuer()}/api/mcp` never doubles up. */
function appUrl(): string {
    return (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/+$/, "")
}

export class OAuthServerConfig {
    /** RFC 8414 `issuer`. Empty string when unconfigured — the routes surface that
     *  as a 503 rather than emitting a metadata document that points nowhere. */
    static issuer(): string {
        return appUrl()
    }

    static isConfigured(): boolean {
        return appUrl().length > 0
    }

    /** RFC 8707 / RFC 9728 canonical resource identifier for the MCP server. */
    static resource(): string {
        return `${appUrl()}/api/mcp`
    }

    static authorizationEndpoint(): string {
        return `${appUrl()}/oauth/authorize`
    }

    static tokenEndpoint(): string {
        return `${appUrl()}/api/oauth/token`
    }

    static registrationEndpoint(): string {
        return `${appUrl()}/api/oauth/register`
    }

    static revocationEndpoint(): string {
        return `${appUrl()}/api/oauth/revoke`
    }

    /** RFC 9728 Protected Resource Metadata. Built here (not in the route) because
     *  TWO routes must serve a byte-identical document — the bare
     *  /.well-known/oauth-protected-resource and the path-suffixed
     *  /.well-known/oauth-protected-resource/api/mcp that other clients probe. If
     *  they ever disagreed, half of them would be sent to the wrong AS. */
    static protectedResourceMetadata(): Record<string, unknown> {
        return {
            resource: OAuthServerConfig.resource(),
            authorization_servers: [OAuthServerConfig.issuer()],
            scopes_supported: ["mcp:read"],
            bearer_methods_supported: ["header"],
        }
    }

    /** RFC 8414 Authorization Server Metadata — how a client discovers where to
     *  send the user, where to redeem the code, and what this server will accept.
     *
     *  `code_challenge_methods_supported: ["S256"]` and
     *  `token_endpoint_auth_methods_supported: ["none"]` together say "public
     *  clients, PKCE mandatory" — which is the OAuth 2.1 posture this server
     *  actually enforces, not just advertises.
     *  `authorization_response_iss_parameter_supported` tells the client we stamp
     *  `iss` on the redirect so it can detect an AS mix-up (RFC 9207). */
    static authorizationServerMetadata(): Record<string, unknown> {
        return {
            issuer: OAuthServerConfig.issuer(),
            authorization_endpoint: OAuthServerConfig.authorizationEndpoint(),
            token_endpoint: OAuthServerConfig.tokenEndpoint(),
            registration_endpoint: OAuthServerConfig.registrationEndpoint(),
            revocation_endpoint: OAuthServerConfig.revocationEndpoint(),
            scopes_supported: ["mcp:read"],
            response_types_supported: ["code"],
            grant_types_supported: ["authorization_code", "refresh_token"],
            code_challenge_methods_supported: ["S256"],
            token_endpoint_auth_methods_supported: ["none"],
            authorization_response_iss_parameter_supported: true,
        }
    }
}
