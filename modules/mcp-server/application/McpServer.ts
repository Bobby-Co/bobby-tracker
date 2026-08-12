// MCP server — protocol dispatch. Turns one JSON-RPC message into one JSON-RPC
// response, independent of HTTP: the route owns the transport (auth, headers,
// status codes) and hands the parsed message here.
//
// This is a TOOLS-ONLY, STATELESS server. It advertises no resources/prompts and
// keeps no session between calls, which is what lets it run on a serverless host
// where consecutive requests may hit different instances. Everything the server
// needs to answer a call arrives on the call itself.

import {
    type JsonRpcRequest,
    type JsonRpcResponse,
    RpcError,
    rpcFailure,
    rpcSuccess,
    isNotification,
} from "../domain/JsonRpc"
import { McpToolError, errorResult } from "../domain/McpTool"
import { TOOL_DEFINITIONS, executeTool } from "./tools"
import type { KnowledgeBaseService } from "./KnowledgeBaseService"

/** Protocol revisions we can speak. If a client asks for one of these we echo it
 *  back; otherwise we answer with our preferred version and let the client decide
 *  whether it can proceed (per the MCP version-negotiation rules). */
const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26"]
const PREFERRED_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0]

const SERVER_INFO = { name: "ucelot", title: "Ucelot Knowledge Base", version: "1.0.0" }

const INSTRUCTIONS = [
    "Ucelot exposes indexed knowledge graphs of the user's codebases.",
    "",
    "Before exploring a repository by grepping or opening files, call locate_files with a plain-language description of what you need to change or understand. It returns the ranked files and the exact file:line snippets that matter, so you can read only those and go straight to implementing.",
    "Use ask_codebase for 'how does this work' questions, and list_knowledge_bases when you don't know which project name to pass.",
    "Only projects the user has explicitly enabled for MCP are visible.",
].join("\n")

export class McpServer {
    constructor(private readonly service: KnowledgeBaseService) {}

    /** Dispatch one message. Returns null for a notification (which must get an
     *  empty HTTP body, never a JSON-RPC response). */
    async handle(message: JsonRpcRequest): Promise<JsonRpcResponse | null> {
        const id = message.id ?? null
        const notification = isNotification(message)

        switch (message.method) {
            case "initialize":
                return notification ? null : rpcSuccess(id, this.initialize(message.params))

            // Lifecycle notifications we acknowledge by staying silent.
            case "notifications/initialized":
            case "notifications/cancelled":
                return null

            case "ping":
                return notification ? null : rpcSuccess(id, {})

            case "tools/list":
                return notification ? null : rpcSuccess(id, { tools: TOOL_DEFINITIONS })

            case "tools/call":
                return notification ? null : this.callTool(id, message.params)

            // Advertised as unsupported in `initialize`, but answer empty rather
            // than erroring — some clients probe these regardless.
            case "resources/list":
                return notification ? null : rpcSuccess(id, { resources: [] })
            case "prompts/list":
                return notification ? null : rpcSuccess(id, { prompts: [] })

            default:
                if (notification) return null
                return rpcFailure(id, RpcError.methodNotFound, `unknown method "${message.method}"`)
        }
    }

    private initialize(params: Record<string, unknown> | undefined): Record<string, unknown> {
        const requested = typeof params?.protocolVersion === "string" ? params.protocolVersion : null
        const protocolVersion =
            requested && SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : PREFERRED_PROTOCOL_VERSION
        return {
            protocolVersion,
            capabilities: { tools: { listChanged: false } },
            serverInfo: SERVER_INFO,
            instructions: INSTRUCTIONS,
        }
    }

    private async callTool(id: JsonRpcRequest["id"], params: Record<string, unknown> | undefined) {
        const name = params?.name
        if (typeof name !== "string") {
            return rpcFailure(id ?? null, RpcError.invalidParams, "tools/call requires a string `name`")
        }
        const args = (params?.arguments ?? {}) as Record<string, unknown>

        try {
            return rpcSuccess(id ?? null, await executeTool(name, args, this.service))
        } catch (e) {
            // MCP convention: a tool that FAILED still returns a result, flagged
            // isError, so the model can read why and correct itself. Only a
            // genuinely unknown tool is a protocol-level error.
            if (e instanceof McpToolError) return rpcSuccess(id ?? null, errorResult(e.message))
            const message = e instanceof Error ? e.message : String(e)
            if (message.startsWith("unknown tool")) {
                return rpcFailure(id ?? null, RpcError.methodNotFound, message)
            }
            return rpcSuccess(id ?? null, errorResult(`Tool "${name}" failed: ${message}`))
        }
    }
}
