// MCP server — bearer authentication for the resource server.
//
// The MCP endpoint is an OAuth 2.1 PROTECTED RESOURCE. Claude obtains a token
// through the authorization server in modules/mcp-oauth (browser consent + PKCE)
// and presents it here on every call. Tokens are opaque and resolved against the
// database, so revoking one takes effect on the next request.
//
// A 401 from this resource must advertise WHERE to get a token, or a client can't
// start the flow — that's the `WWW-Authenticate: Bearer resource_metadata=…`
// challenge built here (RFC 9728).

import { resolveAccessToken } from "@/modules/mcp-oauth"

export interface McpPrincipal {
    userId: string
    clientId: string
    scopes: string[]
}

/** The scope every tool call requires. */
export const MCP_SCOPE = "mcp:read"

function appUrl(): string {
    return (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/+$/, "")
}

/** Resolve the caller from the Authorization header, or null when absent/invalid.
 *  Never throws: a malformed token is simply an unauthenticated request. */
export async function authenticateMcp(request: Request): Promise<McpPrincipal | null> {
    const header = request.headers.get("authorization") || ""
    const match = /^Bearer\s+(.+)$/i.exec(header.trim())
    if (!match) return null
    const raw = match[1].trim()
    if (!raw) return null

    try {
        const claims = await resolveAccessToken(raw)
        if (!claims) return null
        return { userId: claims.userId, clientId: claims.clientId, scopes: claims.scopes }
    } catch {
        // A resolver failure (DB blip, unapplied migration) must not read as a
        // valid session — fail closed.
        return null
    }
}

/** The RFC 9728 challenge telling the client which authorization server to use.
 *  `error` is omitted for a plain "no credentials" 401 per RFC 6750. */
export function unauthorizedResponse(error?: string, description?: string): Response {
    const params = [`resource_metadata="${appUrl()}/.well-known/oauth-protected-resource"`]
    if (error) params.push(`error="${error}"`)
    if (description) params.push(`error_description="${description}"`)

    return new Response(JSON.stringify({ error: error ?? "unauthorized", error_description: description }), {
        status: 401,
        headers: {
            "Content-Type": "application/json",
            "WWW-Authenticate": `Bearer ${params.join(", ")}`,
            "Cache-Control": "no-store",
        },
    })
}
