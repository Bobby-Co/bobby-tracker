// The MCP endpoint — Streamable HTTP transport for the Model Context Protocol.
//
// This is what a user points Claude at:
//     claude mcp add --transport http ucelot https://<app>/api/mcp
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

// Traced for the same reason the token endpoint is: a client that fails here
// reports nothing more useful than "couldn't connect", and the alternative is
// guessing which of auth, protocol or a tool call went wrong. Tokens are never
// logged — only whether one was present and how it resolved.
function trace(message: string): void {
    console.warn(`[mcp] ${message}`)
}

export async function OPTIONS(): Promise<Response> {
    trace("OPTIONS preflight")
    return new Response(null, { status: 204, headers: CORS_HEADERS })
}

// How often to write a comment frame. Any traffic keeps proxies from reaping an
// idle connection; SSE comments are ignored by the client's parser.
const KEEPALIVE_MS = 15_000
// Streams are recycled rather than held forever: a serverless instance shouldn't
// pin a connection indefinitely, and an MCP client reconnects on close.
const STREAM_MAX_MS = 10 * 60_000

/** GET is the Streamable HTTP server→client channel.
 *
 *  This server is stateless and tools-only, so it has nothing to push, and the
 *  MCP spec explicitly allows answering 405 here. That is what we did — and
 *  Claude Desktop treats it as a failed connection, tears down, and re-runs the
 *  whole OAuth dance, looping forever (observed: 405 → re-register → re-consent,
 *  three client_ids in ten minutes). Being technically permitted is worth nothing
 *  if the client on the other end disagrees.
 *
 *  So the stream is opened and simply held: an initial comment to flush headers,
 *  keepalives thereafter, and no messages, which is truthful for a server with
 *  no server-initiated traffic. */
export async function GET(request: Request): Promise<Response> {
    const hadBearer = /^Bearer\s+\S/i.test(request.headers.get("authorization") ?? "")
    const principal = await authenticateMcp(request)
    if (!principal) {
        trace(hadBearer ? "GET 401 — bearer present but did not resolve" : "GET 401 — no bearer presented")
        return withCors(unauthorizedResponse())
    }
    if (!principal.scopes.includes(MCP_SCOPE)) {
        trace(`GET 401 — token scopes [${principal.scopes.join(",")}] lack ${MCP_SCOPE}`)
        return withCors(unauthorizedResponse("insufficient_scope", `token is missing the ${MCP_SCOPE} scope`))
    }

    trace("GET — opening SSE channel")
    const encoder = new TextEncoder()

    const openedAt = Date.now()

    // Driven from pull(), NOT from a timer in start(). On Workers a setInterval
    // scheduled in start() is not reliably retained once the response has been
    // returned: with no pending work the runtime may consider the invocation
    // finished and tear the response down, which the client sees as a stream that
    // died on open — indistinguishable from "this isn't a valid MCP server".
    // Awaiting inside pull() leaves a promise outstanding, which IS tracked as
    // work, so the stream stays alive because it is genuinely still being served.
    const stream = new ReadableStream<Uint8Array>({
        start(controller) {
            // Flush immediately so the client sees an established stream rather
            // than waiting on the first byte.
            controller.enqueue(encoder.encode(": mcp stream open\n\n"))
        },
        async pull(controller) {
            if (request.signal.aborted || Date.now() - openedAt > STREAM_MAX_MS) {
                controller.close()
                return
            }
            await new Promise((resolve) => setTimeout(resolve, KEEPALIVE_MS))
            if (request.signal.aborted) {
                controller.close()
                return
            }
            // A comment frame: ignored by the client's SSE parser, but it is
            // traffic, which is what stops an intermediary reaping the connection.
            controller.enqueue(encoder.encode(": keepalive\n\n"))
        },
    })

    return new Response(stream, {
        status: 200,
        headers: {
            // Matched byte-for-byte to app/api/projects/[id]/mind/route.ts, the
            // SSE route already streaming in production here — this stack is known
            // to flush with exactly these, and this is not the place to find out
            // that a different spelling buffers.
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
            // Defeats proxy buffering, which would otherwise hold the keepalives
            // and leave the client believing the stream never opened.
            "X-Accel-Buffering": "no",
            ...CORS_HEADERS,
        },
    })
}

export async function POST(request: Request): Promise<Response> {
    // ─── authenticate ────────────────────────────────────────────────────────
    const hadBearer = /^Bearer\s+\S/i.test(request.headers.get("authorization") ?? "")
    const principal = await authenticateMcp(request)
    if (!principal) {
        // Distinguishing "sent nothing" from "sent something that didn't resolve"
        // is the difference between a client that never got a token and one whose
        // token is expired, revoked, or for another deployment.
        trace(hadBearer ? "401 — bearer present but did not resolve" : "401 — no bearer presented")
        return withCors(unauthorizedResponse())
    }
    if (!principal.scopes.includes(MCP_SCOPE)) {
        trace(`401 — token scopes [${principal.scopes.join(",")}] lack ${MCP_SCOPE}`)
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
            trace("received a payload that is not a JSON-RPC 2.0 message")
            responses.push(rpcFailure(null, RpcError.invalidRequest, "not a JSON-RPC 2.0 message"))
            continue
        }
        const label = message.method === "tools/call" ? `tools/call ${String(message.params?.name ?? "?")}` : message.method
        try {
            const response = await server.handle(message)
            trace(`${label} → ok`)
            // null = notification: the spec requires no reply for those.
            if (response) responses.push(response)
        } catch (e) {
            const detail = e instanceof Error ? e.message : String(e)
            trace(`${label} → THREW: ${detail}`)
            responses.push(rpcFailure(message.id ?? null, RpcError.internal, `internal error: ${detail}`))
        }
    }

    // A body containing only notifications gets 202 + no content.
    if (responses.length === 0) return new Response(null, { status: 202, headers: CORS_HEADERS })

    return json(Array.isArray(payload) ? responses : responses[0])
}
