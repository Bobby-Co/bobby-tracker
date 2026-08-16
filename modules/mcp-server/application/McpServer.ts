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
import type { KnowledgeBase, KnowledgeBaseService } from "./KnowledgeBaseService"

/** Protocol revisions we can speak, newest first. If a client asks for one of
 *  these we echo it back; otherwise we answer with our preferred version and let
 *  the client decide whether it can proceed (per the MCP version-negotiation
 *  rules).
 *
 *  2025-11-25 is listed because that is what current clients ask for — the MCP
 *  Inspector requests it, and Anthropic's own connector beta
 *  (`mcp-client-2025-11-20`) cites that revision's authorization spec. We were
 *  answering 2025-06-18 to every one of them, i.e. downgrading every modern
 *  client on its very first message. A lenient client shrugs; a strict one has
 *  every right to give up there, and it would look like a connection failure
 *  with no explanation.
 *
 *  Nothing in the newer revisions obliges a TOOLS-ONLY server to do more work:
 *  tasks, elicitation and the UI extensions are client capabilities or optional
 *  server features, and we simply don't advertise them. */
const SUPPORTED_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"]
const PREFERRED_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0]

const SERVER_INFO = { name: "ucelot", title: "Ucelot Knowledge Base", version: "1.0.0" }

/** Cap on the roster below. A user with more knowledge bases than this doesn't
 *  need all of them recited into every session's context — the tail is one
 *  list_knowledge_bases call away. */
const MAX_LISTED_BASES = 25

/** The roster is the reason `initialize` does I/O at all.
 *
 *  A remote MCP server cannot see the caller's working directory, so the agent
 *  used to answer "is this repo indexed?" with a list_knowledge_bases round trip
 *  before its first real question — friction that, often enough, ended with it
 *  quietly grepping instead. Inlining the catalogue here settles it with no tool
 *  call at all: `instructions` lands in the model's context at session start, and
 *  it can match the checkout in front of it against these names itself.
 *
 *  The empty case earns its place too: knowing there is nothing to query stops the
 *  agent spending a call to find that out. */
function renderRoster(bases: KnowledgeBase[]): string {
    if (bases.length === 0) {
        return [
            "YOU HAVE NO KNOWLEDGE BASES. Either the user has enabled MCP for no project (Ucelot → the project → Integrations), or none has finished indexing.",
            "Do not call these tools in this session — they cannot answer anything. Read the repository directly.",
        ].join("\n")
    }

    const label = (b: KnowledgeBase) =>
        b.repoFullName && b.repoFullName !== b.name ? `${b.repoFullName} (${b.name})` : b.repoFullName || b.name

    const indexed = bases.filter((b) => b.indexed)
    const pending = bases.filter((b) => !b.indexed)
    const lines: string[] = []

    if (indexed.length > 0) {
        lines.push("INDEXED AND QUERYABLE RIGHT NOW:")
        for (const base of indexed.slice(0, MAX_LISTED_BASES)) lines.push(`- ${label(base)}`)
        if (indexed.length > MAX_LISTED_BASES) lines.push(`- … and ${indexed.length - MAX_LISTED_BASES} more`)
        lines.push(
            "",
            "If the repository you are working in is one of these, these tools are the fastest way into it — do not open the task with a repo-wide grep or a directory crawl.",
        )
    } else {
        lines.push("NONE of your knowledge bases have finished indexing, so nothing can be queried yet.")
    }

    if (pending.length > 0) {
        lines.push("", `Still indexing (not queryable): ${pending.slice(0, MAX_LISTED_BASES).map(label).join(", ")}.`)
    }
    return lines.join("\n")
}

function renderInstructions(bases: KnowledgeBase[] | null): string {
    return [
        "Ucelot exposes indexed knowledge graphs of the user's codebases through three tools: locate_files, get_neighbours and list_knowledge_bases.",
        "",
        bases ? renderRoster(bases) : "Call list_knowledge_bases to see which codebases are indexed.",
        "",
        "IDENTIFYING THE REPOSITORY. `project` accepts owner/repo, a bare repo name, the Ucelot project name, or the raw output of `git remote get-url origin` — ssh or https, .git suffix and all. OMIT it entirely when only one knowledge base is listed above; it will be used automatically. You do not need list_knowledge_bases to find the right spelling, and a wrong guess comes back naming the alternatives.",
        "",
        "locate_files answers 'which files do I touch for X' without reading or searching the repository. Ask in plain language — the behaviour or the change you intend, not keywords. It returns ranked paths, why each one ranked, the module and cluster summaries written when the codebase was indexed, and the symbols each file defines. Then you open the two or three that matter and read them properly.",
        "",
        "CALL IT MORE THAN ONCE. This is not a one-shot preamble that you do at the start and then abandon for grep. Call locate_files again every time the task turns a corner: a new sub-question, a term you met in a file and cannot place, a second subsystem the change reaches, or before you conclude that something does not exist. Three to six calls over a task is normal, and each one is cheaper than the reading it saves you.",
        "",
        "get_neighbours walks one hop through the graph from a file, symbol or node id — importers, imports, containment. Single hop, no model in the loop: it is fast and costs nothing, so follow the code with it freely, at any point in the session, as many times as the reading needs. It is not restricted to the start of a task either.",
        "",
        "These tools replace exploratory SEARCH, not reading — they hand you coordinates and context, and you read the files yourself.",
    ].join("\n")
}

export class McpServer {
    constructor(private readonly service: KnowledgeBaseService) {}

    /** Dispatch one message. Returns null for a notification (which must get an
     *  empty HTTP body, never a JSON-RPC response). */
    async handle(message: JsonRpcRequest): Promise<JsonRpcResponse | null> {
        const id = message.id ?? null
        const notification = isNotification(message)

        switch (message.method) {
            case "initialize":
                return notification ? null : rpcSuccess(id, await this.initialize(message.params))

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

    private async initialize(params: Record<string, unknown> | undefined): Promise<Record<string, unknown>> {
        const requested = typeof params?.protocolVersion === "string" ? params.protocolVersion : null
        const protocolVersion =
            requested && SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : PREFERRED_PROTOCOL_VERSION
        return {
            protocolVersion,
            capabilities: { tools: { listChanged: false } },
            serverInfo: SERVER_INFO,
            instructions: await this.instructions(),
        }
    }

    /** The handshake must never fail because the catalogue lookup did. A client
     *  that cannot initialize reports "connection failed" and the user is left
     *  re-running OAuth at a server that is actually fine — far worse than
     *  instructions with no roster in them. */
    private async instructions(): Promise<string> {
        try {
            return renderInstructions(await this.service.list())
        } catch (e) {
            console.warn(`[mcp] initialize: could not list knowledge bases — ${e instanceof Error ? e.message : String(e)}`)
            return renderInstructions(null)
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
