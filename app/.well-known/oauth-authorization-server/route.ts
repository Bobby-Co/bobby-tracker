import { OAuthServerConfig, corsPreflight, discoveryJson } from "@/modules/mcp-oauth"

// RFC 8414 — OAuth 2.0 Authorization Server Metadata. The document that tells a
// client where to send the user, where to redeem the code, where to register
// itself, and what this server will accept.
//
// Public, unauthenticated, CORS-enabled: a client has to be able to read this
// BEFORE it has any credentials — that is the entire point of discovery.
//
// The values come from OAuthServerConfig, which pins them to NEXT_PUBLIC_APP_URL
// rather than the inbound Host header; see that file for why deriving an issuer
// from a request is an attack surface rather than a convenience.

export async function GET() {
    if (!OAuthServerConfig.isConfigured()) {
        return Response.json(
            { error: "server_error", error_description: "NEXT_PUBLIC_APP_URL is not configured" },
            { status: 503 },
        )
    }
    return discoveryJson(OAuthServerConfig.authorizationServerMetadata())
}

export async function OPTIONS() {
    return corsPreflight()
}
