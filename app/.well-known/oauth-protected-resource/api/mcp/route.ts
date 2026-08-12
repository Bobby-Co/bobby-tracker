import { OAuthServerConfig, corsPreflight, discoveryJson } from "@/modules/mcp-oauth"

// RFC 9728 §3.1 path-suffixed form of the protected-resource metadata: for a
// resource at <APP_URL>/api/mcp, the metadata URL is
// <APP_URL>/.well-known/oauth-protected-resource/api/mcp.
//
// Clients differ on which form they probe — some try the bare path, some this
// one, some both — so both have to answer, and answer identically. The document
// comes from OAuthServerConfig for exactly that reason; see the sibling route at
// app/.well-known/oauth-protected-resource/route.ts.

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
