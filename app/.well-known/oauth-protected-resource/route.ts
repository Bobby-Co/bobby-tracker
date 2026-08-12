import { OAuthServerConfig, corsPreflight, discoveryJson } from "@/modules/mcp-oauth"

// RFC 9728 — OAuth 2.0 Protected Resource Metadata.
//
// This is the first thing an MCP client fetches after /api/mcp answers 401: it
// says "the resource is <APP_URL>/api/mcp, and the authorization server guarding
// it is <APP_URL>". The client then follows to
// /.well-known/oauth-authorization-server for the endpoint list.
//
// Clients probe BOTH this bare path and the path-suffixed form
// (/.well-known/oauth-protected-resource/api/mcp, RFC 9728 §3.1), so the same
// document is served from both routes. The document itself is built in
// OAuthServerConfig so the two can never drift apart.
//
// Public, unauthenticated, CORS-enabled — it is metadata by design.

export async function GET() {
    if (!OAuthServerConfig.isConfigured()) {
        return Response.json(
            { error: "server_error", error_description: "NEXT_PUBLIC_APP_URL is not configured" },
            { status: 503 },
        )
    }
    return discoveryJson(OAuthServerConfig.protectedResourceMetadata())
}

export async function OPTIONS() {
    return corsPreflight()
}
