// MCP server — the tool catalogue: what Claude sees in `tools/list`, and how each
// call is executed and rendered.
//
// These tools REPLACE exploratory search, not reading. The caller is a coding
// agent that already has a file reader and a grep; what it lacks is the map. So
// `locate_files` hands back coordinates plus the graph's indexed context —
// ranked paths, why each ranked, the module/cluster prose, the symbols each file
// defines — and NO source. The caller opens the two or three files that matter
// and reads them properly, instead of paying for excerpts here and the same
// bytes again on the read.
//
// `get_neighbours` covers the follow-ups that come after: what calls this, what
// does this import, what implements this. Those are single graph hops, so they
// come back in milliseconds with no model in the loop.

import type { KnowledgeBaseService } from "./KnowledgeBaseService"
import type { RetrieveHints } from "@/modules/analysis"
import { type McpToolDefinition, type McpToolResult, textResult } from "../domain/McpTool"

// Output caps. Generous enough to answer the question, small enough that a call
// stays far cheaper than reading the files it points at.
const MAX_FILES = 12
const MAX_FILE_SYMBOLS = 8
const MAX_WHY = 3
const MAX_SYMBOLS = 20
const MAX_NOTES = 6
const MAX_NEIGHBOURS = 40
const SUMMARY_CHARS = 240

export const TOOL_DEFINITIONS: McpToolDefinition[] = [
    {
        name: "list_knowledge_bases",
        description:
            "List the Ucelot knowledge bases (indexed codebases) you can query. Call this first when you don't know which project name to pass to the other tools, or to check whether the current repository has one.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
        name: "locate_files",
        description:
            "Find which files implement a feature, behaviour or bug in an indexed codebase, WITHOUT searching the repository. Returns ranked file paths with the reason each ranked, the module and cluster they belong to (with the summaries written when the codebase was indexed), and the symbols each file defines. Use it instead of grepping: ask in plain language (e.g. 'where is the OAuth token refreshed?'), then open and read the files it names.",
        inputSchema: {
            type: "object",
            properties: {
                project: {
                    type: "string",
                    description: "Which knowledge base: 'owner/repo', the repo name, or the Ucelot project name.",
                },
                query: {
                    type: "string",
                    description:
                        "What you are looking for, in plain language. Describe the behaviour or change you intend, not keywords.",
                },
                hints: {
                    type: "object",
                    description: "Optional anchors you already know, to focus the search.",
                    properties: {
                        symbols: { type: "array", items: { type: "string" }, description: "Known function/type names." },
                        files: { type: "array", items: { type: "string" }, description: "Known relevant file paths." },
                    },
                    additionalProperties: false,
                },
            },
            required: ["project", "query"],
            additionalProperties: false,
        },
    },
    {
        name: "get_neighbours",
        description:
            "Walk one hop through the codebase graph from a file, symbol or node id: callers and callees, imports and importers, implementations of an interface, the module a file belongs to. Fast and free — no model runs. Use it while reading code to answer 'what calls this', 'what breaks if I change this', 'what implements this' without grepping the repository.",
        inputSchema: {
            type: "object",
            properties: {
                project: {
                    type: "string",
                    description: "Which knowledge base: 'owner/repo', the repo name, or the Ucelot project name.",
                },
                symbol: { type: "string", description: "A function, type or interface name to anchor on." },
                file: {
                    type: "string",
                    description:
                        "A repo-relative file path to anchor on. Resolves to the definitions that file contributes.",
                },
                node_id: { type: "string", description: "An exact graph node id from a previous get_neighbours call." },
                edges: {
                    type: "array",
                    items: {
                        type: "string",
                        enum: [
                            "IMPORTS",
                            "CALLS",
                            "IMPLEMENTS",
                            "EXTENDS",
                            "CONTAINS",
                            "DEFINES",
                            "MEMBER_OF",
                            "MENTIONS",
                            "DEPENDS_ON",
                        ],
                    },
                    description: "Restrict to these edge types. Omit for all of them.",
                },
                direction: {
                    type: "string",
                    enum: ["out", "in", "both"],
                    description:
                        "'out' = what the anchor points at (callees, imports); 'in' = what points at it (callers, importers — the blast radius); 'both' is the default.",
                },
                limit: { type: "integer", description: "Cap on neighbours per anchor. Default 25." },
            },
            required: ["project"],
            additionalProperties: false,
        },
    },
]

// ─── argument coercion — MCP args arrive as untyped JSON ─────────────────────
function requireString(args: Record<string, unknown>, key: string): string {
    const value = args[key]
    if (typeof value !== "string" || !value.trim()) throw new Error(`"${key}" is required and must be a non-empty string`)
    return value.trim()
}

function optionalString(args: Record<string, unknown>, key: string): string | undefined {
    const value = args[key]
    return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function readHints(args: Record<string, unknown>): RetrieveHints | undefined {
    const raw = args.hints
    if (!raw || typeof raw !== "object") return undefined
    const source = raw as Record<string, unknown>
    const strings = (v: unknown) =>
        Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "") : undefined
    const symbols = strings(source.symbols)
    const files = strings(source.files)
    if (!symbols?.length && !files?.length) return undefined
    return { ...(symbols?.length ? { symbols } : {}), ...(files?.length ? { files } : {}) }
}

/** Keep an indexed summary to a line or two — the caller wants orientation, not
 *  the whole write-up, and can open the file for the rest. */
function clampSummary(text: string | undefined): string {
    if (!text) return ""
    const flat = text.replace(/\s+/g, " ").trim()
    return flat.length <= SUMMARY_CHARS ? flat : `${flat.slice(0, SUMMARY_CHARS).trimEnd()}…`
}

// ─── execution ───────────────────────────────────────────────────────────────
export async function executeTool(
    name: string,
    args: Record<string, unknown>,
    service: KnowledgeBaseService,
): Promise<McpToolResult> {
    switch (name) {
        case "list_knowledge_bases":
            return textResult(renderList(await service.list()))

        case "locate_files": {
            const query = requireString(args, "query")
            const { base, evidence } = await service.locate(requireString(args, "project"), query, readHints(args))
            return textResult(renderEvidence(base.repoFullName || base.name, query, evidence))
        }

        case "get_neighbours": {
            const nodeId = optionalString(args, "node_id")
            const symbol = optionalString(args, "symbol")
            const file = optionalString(args, "file")
            if (!nodeId && !symbol && !file) {
                throw new Error(`"symbol", "file" or "node_id" is required — one of them anchors the walk`)
            }
            const { base, graph } = await service.neighbours(requireString(args, "project"), {
                nodeId,
                symbol,
                file,
                edges: Array.isArray(args.edges) ? args.edges.filter((e): e is string => typeof e === "string") : undefined,
                direction: optionalString(args, "direction"),
                limit: typeof args.limit === "number" ? args.limit : undefined,
            })
            return textResult(renderNeighbours(base.repoFullName || base.name, nodeId || symbol || file || "", graph))
        }

        default:
            throw new Error(`unknown tool "${name}"`)
    }
}

// ─── rendering ───────────────────────────────────────────────────────────────
function renderList(bases: Awaited<ReturnType<KnowledgeBaseService["list"]>>): string {
    if (bases.length === 0) {
        return "No knowledge bases are available to you.\n\nTo expose one: open the project in Ucelot → Integrations tab → enable MCP access. The project also needs to have finished indexing."
    }
    const lines = bases.map((b) => {
        const label = b.repoFullName ? `${b.repoFullName} (${b.name})` : b.name
        const state = b.indexed ? "" : "  — NOT INDEXED YET, cannot be queried"
        const desc = b.description ? `\n    ${b.description}` : ""
        return `- ${label}${state}${desc}`
    })
    return `Available knowledge bases (${bases.length}):\n${lines.join("\n")}\n\nPass one of these to locate_files or get_neighbours as "project".`
}

function renderEvidence(
    project: string,
    query: string,
    evidence: Awaited<ReturnType<KnowledgeBaseService["locate"]>>["evidence"],
): string {
    const out: string[] = [`# Where "${query}" lives in ${project}`]

    if (evidence.files.length === 0) {
        return `${out[0]}\n\nThe retriever found nothing relevant. Try rephrasing in terms of observable behaviour, or fall back to reading the repository directly.`
    }

    // One block per file: path first (it is what the caller acts on), then the
    // reasons, then the indexed context, then what the file defines.
    const blocks = evidence.files.slice(0, MAX_FILES).map((f, i) => {
        const lines = [`${i + 1}. ${f.file}  (score ${f.score.toFixed(2)}${f.opens ? `, ${f.opens} opens` : ""})`]
        for (const why of (f.why ?? []).slice(0, MAX_WHY)) lines.push(`   why: ${why}`)
        if (f.module) {
            const summary = clampSummary(f.module_summary)
            lines.push(`   module ${f.module}${summary ? ` — ${summary}` : ""}`)
        }
        if (f.cluster) {
            const summary = clampSummary(f.cluster_summary)
            lines.push(`   cluster ${f.cluster}${summary ? ` — ${summary}` : ""}`)
        }
        if (f.symbols?.length) {
            const symbols = f.symbols
                .slice(0, MAX_FILE_SYMBOLS)
                .map((s) => `${s.name}${s.line ? `:${s.line}` : ""}`)
                .join(", ")
            const more = f.symbols.length > MAX_FILE_SYMBOLS ? `, +${f.symbols.length - MAX_FILE_SYMBOLS} more` : ""
            lines.push(`   defines: ${symbols}${more}`)
        }
        return lines.join("\n")
    })
    const more = evidence.files.length > MAX_FILES ? `\n… ${evidence.files.length - MAX_FILES} more` : ""
    out.push(`\n## Ranked files\n${blocks.join("\n\n")}${more}`)

    if (evidence.symbols.length > 0) {
        const rows = evidence.symbols.slice(0, MAX_SYMBOLS).map((s) => {
            const where = s.line ? `${s.file}:${s.line}` : s.file
            return `- ${s.name} → ${where}${s.kind ? ` (${s.kind})` : ""}`
        })
        out.push(`\n## Symbols named in the query\n${rows.join("\n")}`)
    }

    if (evidence.notes.length > 0) {
        out.push(`\n## Notes\n${evidence.notes.slice(0, MAX_NOTES).map((n) => `- ${n}`).join("\n")}`)
    }

    out.push(`\nRead the top files above. To follow the code from there — callers, imports, implementations — call get_neighbours instead of grepping.`)

    const s = evidence.stats
    if (s) {
        const parts = [
            s.agents_run ? `${s.agents_run} agents` : null,
            s.clusters_visited ? `${s.clusters_visited} clusters` : null,
            typeof s.cost_usd === "number" ? `$${s.cost_usd.toFixed(3)}` : null,
            typeof s.duration_ms === "number" ? `${(s.duration_ms / 1000).toFixed(1)}s` : null,
        ].filter(Boolean)
        if (parts.length) out.push(`\n_${parts.join(" · ")}_`)
    }

    return out.join("\n")
}

function renderNeighbours(
    project: string,
    anchor: string,
    graph: Awaited<ReturnType<KnowledgeBaseService["neighbours"]>>["graph"],
): string {
    const out = [`# Graph neighbours of ${anchor} in ${project}`]

    if (graph.anchors.length === 0) {
        return `${out[0]}\n\nNothing in the graph matches that anchor. Check the path or symbol spelling, or use locate_files to find the right one.`
    }

    const anchored = graph.anchors
        .map((a) => `- ${a.name} (${a.kind})${a.file ? ` — ${a.file}${a.line ? `:${a.line}` : ""}` : ""}`)
        .join("\n")
    out.push(`\n## Anchored on\n${anchored}`)

    if (graph.neighbours.length === 0) {
        out.push(`\nNo neighbours over the requested edges. Try direction "both", or drop the edge filter.`)
        return out.join("\n")
    }

    // Grouped by kind so a long list stays scannable; the analyser already
    // ordered by centrality, so the first of each group is the important one.
    const groups = new Map<string, typeof graph.neighbours>()
    for (const n of graph.neighbours.slice(0, MAX_NEIGHBOURS)) {
        const list = groups.get(n.kind) ?? []
        list.push(n)
        groups.set(n.kind, list)
    }
    for (const [kind, nodes] of groups) {
        const rows = nodes.map((n) => {
            const where = n.file ? `${n.file}${n.line ? `:${n.line}` : ""}` : ""
            const summary = clampSummary(n.summary)
            return `- ${n.name}${where ? `  — ${where}` : ""}${summary ? `\n    ${summary}` : ""}`
        })
        out.push(`\n## ${kind}\n${rows.join("\n")}`)
    }
    if (graph.neighbours.length > MAX_NEIGHBOURS) {
        out.push(`\n… ${graph.neighbours.length - MAX_NEIGHBOURS} more`)
    }
    if (graph.truncated) {
        out.push(`\n_Hit the per-anchor limit — narrow with \`edges\` or \`direction\` for the full picture._`)
    }
    return out.join("\n")
}
