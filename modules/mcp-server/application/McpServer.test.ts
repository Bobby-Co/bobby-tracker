// Protocol-level tests for McpServer. These pin the JSON-RPC/MCP contract a
// client depends on — notably the two rules that are easy to get wrong and that
// break clients loudly when they are:
//
//   • a NOTIFICATION (no id) must produce no response at all, and
//   • a failing TOOL is a successful JSON-RPC response carrying isError, not a
//     protocol error — otherwise the model never sees the message telling it how
//     to correct the call.

import { test, expect, describe, mock } from "bun:test"
import { McpServer } from "./McpServer"
import { McpToolError } from "../domain/McpTool"
import { RpcError } from "../domain/JsonRpc"

const service = { list: mock(), resolve: mock(), locate: mock(), neighbours: mock() }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const server = () => new McpServer(service as any)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ok = (r: any) => r.result
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const err = (r: any) => r.error

describe("initialize", () => {
    test("echoes a protocol version it supports", async () => {
        const res = await server().handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } })
        expect(ok(res).protocolVersion).toBe("2025-03-26")
    })

    // The regression that matters: current clients (the MCP Inspector, and
    // Anthropic's connector) ask for 2025-11-25. Answering anything else
    // downgrades every modern client on its first message.
    test("echoes the current revision rather than downgrading it", async () => {
        const res = await server().handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25" } })
        expect(ok(res).protocolVersion).toBe("2025-11-25")
    })

    test("falls back to its preferred version for an unknown one", async () => {
        const res = await server().handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "1999-01-01" } })
        expect(ok(res).protocolVersion).toBe("2025-11-25")
    })

    test("advertises tools and identifies the server", async () => {
        const res = await server().handle({ jsonrpc: "2.0", id: 1, method: "initialize" })
        expect(ok(res).capabilities.tools).toBeDefined()
        expect(ok(res).serverInfo.name).toBe("ucelot")
        // The instructions are what steer the model to call the tool BEFORE it
        // starts opening files — the whole point of the integration.
        expect(ok(res).instructions).toContain("locate_files")
    })
})

describe("notifications", () => {
    test("initialized produces no response", async () => {
        expect(await server().handle({ jsonrpc: "2.0", method: "notifications/initialized" })).toBeNull()
    })

    test("a request without an id is never answered, even for a real method", async () => {
        expect(await server().handle({ jsonrpc: "2.0", method: "tools/list" })).toBeNull()
    })
})

describe("tools/list", () => {
    test("advertises exactly the three tools, with schemas", async () => {
        const res = await server().handle({ jsonrpc: "2.0", id: 2, method: "tools/list" })
        const names = ok(res).tools.map((t: { name: string }) => t.name)
        expect(names).toEqual(["list_knowledge_bases", "locate_files", "get_neighbours"])
        for (const tool of ok(res).tools) expect(tool.inputSchema.type).toBe("object")
    })

    // get_neighbours takes ONE of symbol/file/node_id, so the anchor cannot be
    // required by schema — the tool checks it and reports back to the model.
    test("get_neighbours requires only the project by schema", async () => {
        const res = await server().handle({ jsonrpc: "2.0", id: 2, method: "tools/list" })
        const tool = ok(res).tools.find((t: { name: string }) => t.name === "get_neighbours")
        expect(tool.inputSchema.required).toEqual(["project"])
    })

    test("locate_files requires project and query", async () => {
        const res = await server().handle({ jsonrpc: "2.0", id: 2, method: "tools/list" })
        const locate = ok(res).tools.find((t: { name: string }) => t.name === "locate_files")
        expect(locate.inputSchema.required).toEqual(["project", "query"])
    })
})

describe("tools/call", () => {
    test("renders a successful result as text content", async () => {
        service.list.mockResolvedValue([
            { projectId: "p1", name: "Tracker", repoFullName: "acme/tracker", description: null, indexed: true },
        ])
        const res = await server().handle({
            jsonrpc: "2.0", id: 3, method: "tools/call",
            params: { name: "list_knowledge_bases", arguments: {} },
        })
        expect(ok(res).content[0].type).toBe("text")
        expect(ok(res).content[0].text).toContain("acme/tracker")
    })

    test("a user-correctable tool failure comes back as isError, NOT a protocol error", async () => {
        service.locate.mockRejectedValue(new McpToolError("No knowledge base matches \"ghost\"."))
        const res = await server().handle({
            jsonrpc: "2.0", id: 4, method: "tools/call",
            params: { name: "locate_files", arguments: { project: "ghost", query: "x" } },
        })
        expect(err(res)).toBeUndefined()
        expect(ok(res).isError).toBe(true)
        expect(ok(res).content[0].text).toContain("ghost")
    })

    test("a missing required argument is reported to the model, not thrown away", async () => {
        const res = await server().handle({
            jsonrpc: "2.0", id: 5, method: "tools/call",
            params: { name: "locate_files", arguments: { project: "p1" } },
        })
        expect(ok(res).isError).toBe(true)
        expect(ok(res).content[0].text).toContain("query")
    })

    // An empty neighbour list reads as "nothing references this" — the most
    // dangerous thing this tool could imply before a refactor. The analyser's
    // notes carry the real reason, so they must lead the rendering.
    test("an empty get_neighbours result renders the reason, not a bare nothing", async () => {
        service.neighbours.mockResolvedValue({
            base: { repoFullName: "acme/app", name: "App" },
            graph: {
                anchors: [{ id: "function:ts:lib/session:resolvePublicSession", kind: "Function", name: "resolvePublicSession" }],
                neighbours: [],
                notes: ["CALLS is not indexed in this graph AT ALL — the empty result says nothing about the code."],
            },
        })
        const res = await server().handle({
            jsonrpc: "2.0", id: 11, method: "tools/call",
            params: { name: "get_neighbours", arguments: { project: "p1", symbol: "resolvePublicSession", edges: ["CALLS"] } },
        })
        const text = ok(res).content[0].text
        expect(text).toContain("not indexed in this graph")
        expect(text).toContain("read this before concluding")
    })

    // Escalated anchors and their rows must stay distinguishable: an importer of
    // the containing module is not a caller of the symbol.
    test("get_neighbours attributes escalated anchors and rows", async () => {
        service.neighbours.mockResolvedValue({
            base: { repoFullName: "acme/app", name: "App" },
            graph: {
                anchors: [
                    { id: "function:ts:lib/session:resolvePublicSession", kind: "Function", name: "resolvePublicSession" },
                    { id: "module:ts:lib/session", kind: "Module", name: "lib/session", via: "defines resolvePublicSession" },
                ],
                neighbours: [{ id: "module:ts:app/api/a", kind: "Module", name: "app/api/a", via: "lib/session" }],
                notes: ["IMPORTS / DEPENDS_ON / MEMBER_OF are MODULE-level edges…"],
            },
        })
        const res = await server().handle({
            jsonrpc: "2.0", id: 12, method: "tools/call",
            params: { name: "get_neighbours", arguments: { project: "p1", symbol: "resolvePublicSession", direction: "in" } },
        })
        const text = ok(res).content[0].text
        expect(text).toContain("[added automatically: defines resolvePublicSession]")
        expect(text).toContain("[via lib/session]")
        expect(text).toContain("How to read this")
    })

    test("get_neighbours without an anchor tells the model what is missing", async () => {
        const res = await server().handle({
            jsonrpc: "2.0", id: 13, method: "tools/call",
            params: { name: "get_neighbours", arguments: { project: "p1" } },
        })
        expect(ok(res).isError).toBe(true)
        expect(ok(res).content[0].text).toContain("symbol")
    })

    test("an unknown tool IS a protocol error", async () => {
        const res = await server().handle({
            jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "rm_rf", arguments: {} },
        })
        expect(err(res).code).toBe(RpcError.methodNotFound)
    })

    test("a non-string tool name is an invalid-params error", async () => {
        const res = await server().handle({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: 42 } })
        expect(err(res).code).toBe(RpcError.invalidParams)
    })
})

describe("unknown methods", () => {
    test("return method-not-found", async () => {
        const res = await server().handle({ jsonrpc: "2.0", id: 8, method: "resources/subscribe" })
        expect(err(res).code).toBe(RpcError.methodNotFound)
    })

    test("probed resources/prompts lists answer empty rather than erroring", async () => {
        const r1 = await server().handle({ jsonrpc: "2.0", id: 9, method: "resources/list" })
        const r2 = await server().handle({ jsonrpc: "2.0", id: 10, method: "prompts/list" })
        expect(ok(r1).resources).toEqual([])
        expect(ok(r2).prompts).toEqual([])
    })
})
