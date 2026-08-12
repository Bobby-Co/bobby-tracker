// MCP server module — PUBLIC CONTRACT (see modules/README.md). The Model Context
// Protocol surface that lets an external AI assistant (Claude) query a project's
// indexed knowledge base instead of exploring the repository file by file.
//
// The transport lives in app/api/mcp/route.ts and is deliberately thin: it
// authenticates, parses JSON-RPC, and delegates to McpServer. Everything that
// decides WHAT a caller may see is in KnowledgeBaseService.

// ─── protocol ────────────────────────────────────────────────────────────────
export { McpServer } from "./application/McpServer"
export { TOOL_DEFINITIONS } from "./application/tools"
export {
    type JsonRpcRequest,
    type JsonRpcResponse,
    RpcError,
    rpcFailure,
    isJsonRpcRequest,
} from "./domain/JsonRpc"
export { type McpToolDefinition, type McpToolResult, McpToolError } from "./domain/McpTool"

// ─── application ─────────────────────────────────────────────────────────────
// Callers build the service through the composition seam; the class is exported
// for typing and tests, not to be constructed with hand-wired adapters.
export { KnowledgeBaseService } from "./application/KnowledgeBaseService"
export type { KnowledgeBase, ResolvedKnowledgeBase } from "./application/KnowledgeBaseService"
export { createKnowledgeBaseService } from "./Composition"

// ─── infrastructure ──────────────────────────────────────────────────────────
export { authenticateMcp, unauthorizedResponse, MCP_SCOPE } from "./infrastructure/McpAuth"
export type { McpPrincipal } from "./infrastructure/McpAuth"
