import { OAuthServerConfig, corsPreflight, discoveryJson } from "@/modules/mcp-oauth"

// RFC 9728 §3.1 path-suffixed metadata for the /mcp alias.
//
// A client that connects to <APP_URL>/mcp probes
// /.well-known/oauth-protected-resource/mcp, and RFC 8707 asks it to treat the
// `resource` it finds as the canonical identifier for what it is calling. Serving
// the /api/mcp document here would hand such a client an identifier that differs
// from the URL it dialled — a mismatch a strict client is entitled to reject, and
// one that would quietly defeat the point of the alias.
//
// Everything else is the shared document; only `resource` differs.

export async function GET() {
    if (!OAuthServerConfig.isConfigured()) {
        return Response.json(
            { error: "server_error", error_description: "NEXT_PUBLIC_APP_URL is not configured" },
            { status: 503 },
        )
    }
    return discoveryJson({
        ...OAuthServerConfig.protectedResourceMetadata(),
        resource: `${OAuthServerConfig.issuer()}/mcp`,
    })
}

export async function OPTIONS() {
    return corsPreflight()
}
