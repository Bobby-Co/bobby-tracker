// MCP server — the TOOL vocabulary: how a tool is advertised (`tools/list`) and
// how its outcome is returned (`tools/call`). Pure data.
//
// Note the MCP convention that a tool FAILURE is not a protocol error: it comes
// back as a normal result with `isError: true`, so the model can read the message
// and correct itself (wrong project name, project not indexed yet, …) instead of
// the client tearing down the call. McpToolError carries exactly that kind of
// user-correctable failure.

export interface McpToolDefinition {
    name: string
    /** Shown to the model — this is what makes it reach for the tool, so it states
     *  the payoff ("instead of grepping…") not just the mechanics. */
    description: string
    inputSchema: Record<string, unknown>
}

export interface McpTextContent {
    type: "text"
    text: string
}

export interface McpToolResult {
    content: McpTextContent[]
    isError?: boolean
}

export function textResult(text: string): McpToolResult {
    return { content: [{ type: "text", text }] }
}

export function errorResult(text: string): McpToolResult {
    return { content: [{ type: "text", text }], isError: true }
}

/** A tool failure the CALLER can act on: an unknown project, an ambiguous name, a
 *  project that isn't indexed yet. Rendered as `isError: true` content so the model
 *  reads the guidance and retries; it is never a JSON-RPC protocol error. */
export class McpToolError extends Error {
    constructor(message: string) {
        super(message)
        this.name = "McpToolError"
    }
}
