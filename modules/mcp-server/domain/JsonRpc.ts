// MCP server — the JSON-RPC 2.0 wire vocabulary. Pure data + constructors: no
// transport, no framework, no knowledge of what the methods DO. The Streamable
// HTTP transport (app/api/mcp/route.ts) parses into these and serialises them
// back; McpServer dispatches on them.

/** A JSON-RPC id. A NOTIFICATION has none — and must never be answered. */
export type JsonRpcId = string | number | null

export interface JsonRpcRequest {
    jsonrpc: "2.0"
    id?: JsonRpcId
    method: string
    params?: Record<string, unknown>
}

export interface JsonRpcSuccess {
    jsonrpc: "2.0"
    id: JsonRpcId
    result: unknown
}

export interface JsonRpcFailure {
    jsonrpc: "2.0"
    id: JsonRpcId
    error: { code: number; message: string; data?: unknown }
}

export type JsonRpcResponse = JsonRpcSuccess | JsonRpcFailure

/** The standard JSON-RPC 2.0 error codes (MCP adds no codes of its own; a failing
 *  TOOL reports itself in-band via `isError`, not as a protocol error). */
export const RpcError = {
    parse: -32700,
    invalidRequest: -32600,
    methodNotFound: -32601,
    invalidParams: -32602,
    internal: -32603,
} as const

export function rpcSuccess(id: JsonRpcId, result: unknown): JsonRpcSuccess {
    return { jsonrpc: "2.0", id, result }
}

export function rpcFailure(id: JsonRpcId, code: number, message: string, data?: unknown): JsonRpcFailure {
    return { jsonrpc: "2.0", id, error: { code, message, ...(data === undefined ? {} : { data }) } }
}

/** True for a well-formed JSON-RPC 2.0 message with a method (request OR
 *  notification). We're deliberately lenient about `jsonrpc` being exactly "2.0"
 *  only where the spec is strict — a missing method is the real disqualifier. */
export function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
    if (!value || typeof value !== "object") return false
    const msg = value as Record<string, unknown>
    return typeof msg.method === "string"
}

/** A notification carries no id, so the transport must return NO body for it. */
export function isNotification(msg: JsonRpcRequest): boolean {
    return msg.id === undefined
}
