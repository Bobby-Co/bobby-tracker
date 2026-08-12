// The MCP endpoint — Streamable HTTP transport for the Model Context Protocol.
//
// This is what a user points Claude at:
//     claude mcp add --transport http ocelot https://<app>/api/mcp
//
// It is an OAuth 2.1 protected resource: a 401 from here carries the
// `WWW-Authenticate` challenge that tells the client where to discover the
// authorization server (modules/mcp-oauth), which is how Claude bootstraps the
// browser consent flow on its own.
//
// The server is TOOLS-ONLY and STATELESS, so this transport implements the POST
// half of Streamable HTTP and nothing else: there is no server-initiated message
// to deliver, so the optional GET/SSE channel is declined with 405 (which the
// spec explicitly allows) and no Mcp-Session-Id is issued. That keeps it correct
// on a serverless host where consecutive requests hit different instances.
//
// Deliberately thin: authenticate, parse, delegate. Every decision about WHAT a
// caller may see lives in KnowledgeBaseService.

import {
    McpServer,
    MCP_SCOPE,
    authenticateMcp,
    createKnowledgeBaseService,
    isJsonRpcRequest,
    rpcFailure,
    unauthorizedResponse,
    RpcError,
    type JsonRpcResponse,
} from "@/modules/mcp-server"

export const dynamic = "force-dynamic"

// Bearer tokens travel in a header, not a cookie, so a wildcard origin exposes
// nothing: a hostile page still can't read a token it doesn't have. claude.ai
// calls this endpoint from the browser, so the preflight has to pass.
const CORS_HEADERS: Record<string, string> = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, MCP-Protocol-Version, Mcp-Session-Id, Last-Event-ID",
    "Access-Control-Expose-Headers": "WWW-Authenticate, MCP-Protocol-Version",
    "Access-Control-Max-Age": "86400",
}

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS_HEADERS },
    })
}

/** Attach CORS to the 401 challenge too — without it a browser client can't even
 *  read the WWW-Authenticate header that starts the OAuth flow. */
function withCors(response: Response): Response {
    const headers = new Headers(response.headers)
    for (const [key, value] of Object.entries(CORS_HEADERS)) headers.set(key, value)
    return new Response(response.body, { status: response.status, headers })
}

export async function OPTIONS(): Promise<Response> {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
}

/** No server-initiated messages exist for a stateless tools-only server, so the
 *  optional SSE channel is declined rather than left hanging open. */
export async function GET(): Promise<Response> {
    return new Response(JSON.stringify({ error: "method_not_allowed", error_description: "This MCP server is POST-only." }), {
        status: 405,
        headers: { "Content-Type": "application/json", Allow: "POST, OPTIONS", ...CORS_HEADERS },
    })
}

export async function POST(request: Request): Promise<Response> {
    // ─── authenticate ────────────────────────────────────────────────────────
    const principal = await authenticateMcp(request)
    if (!principal) return withCors(unauthorizedResponse())
    if (!principal.scopes.includes(MCP_SCOPE)) {
        return withCors(unauthorizedResponse("insufficient_scope", `token is missing the ${MCP_SCOPE} scope`))
    }

    // ─── parse ───────────────────────────────────────────────────────────────
    let payload: unknown
    try {
        payload = await request.json()
    } catch {
        return json(rpcFailure(null, RpcError.parse, "request body is not valid JSON"), 400)
    }

    // ─── dispatch ────────────────────────────────────────────────────────────
    // One service (and one DB client) per HTTP request, shared across a batch.
    const server = new McpServer(createKnowledgeBaseService(principal.userId))

    const messages = Array.isArray(payload) ? payload : [payload]
    if (messages.length === 0) {
        return json(rpcFailure(null, RpcError.invalidRequest, "empty batch"), 400)
    }

    const responses: JsonRpcResponse[] = []
    for (const message of messages) {
        if (!isJsonRpcRequest(message)) {
            responses.push(rpcFailure(null, RpcError.invalidRequest, "not a JSON-RPC 2.0 message"))
            continue
        }
        try {
            const response = await server.handle(message)
            // null = notification: the spec requires no reply for those.
            if (response) responses.push(response)
        } catch (e) {
            const detail = e instanceof Error ? e.message : String(e)
            responses.push(rpcFailure(message.id ?? null, RpcError.internal, `internal error: ${detail}`))
        }
    }

    // A body containing only notifications gets 202 + no content.
    if (responses.length === 0) return new Response(null, { status: 202, headers: CORS_HEADERS })

    return json(Array.isArray(payload) ? responses : responses[0])
}
