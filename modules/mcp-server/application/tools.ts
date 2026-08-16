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

/** Shared by both query tools. It leads with the identifiers the caller already
 *  has — a git remote it can read for free, or nothing at all — rather than the
 *  naming scheme it would otherwise have to go and look up. */
const PROJECT_ARG = {
    type: "string",
    description:
        "Which knowledge base. Accepts 'owner/repo', a bare repo name, the Ucelot project name, or the raw output of `git remote get-url origin` (ssh or https, .git suffix fine). OPTIONAL — omit it when the user has a single knowledge base and it is used automatically. A wrong or ambiguous value comes back naming the alternatives, so guess rather than calling list_knowledge_bases first.",
} as const

export const TOOL_DEFINITIONS: McpToolDefinition[] = [
    {
        name: "list_knowledge_bases",
        description:
            "List the Ucelot knowledge bases (indexed codebases) you can query. You rarely need this: the available bases are already named in this server's instructions, and locate_files/get_neighbours accept a git remote URL or no project at all. Use it to re-check after the user enables a new project or one finishes indexing mid-session.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
        name: "locate_files",
        description:
            "Find which files implement a feature, behaviour or bug in an indexed codebase, WITHOUT searching the repository. Returns ranked file paths with the reason each ranked, the module and cluster they belong to (with the summaries written when the codebase was indexed), and the symbols each file defines. Use it instead of grepping: ask in plain language (e.g. 'where is the OAuth token refreshed?'), then open and read the files it names. CALL IT REPEATEDLY — once per question, not once per session: again for each new sub-question, each unfamiliar term you hit while reading, each further subsystem the change reaches, and before concluding that something does not exist. Three to six calls over a task is normal.",
        inputSchema: {
            type: "object",
            properties: {
                project: PROJECT_ARG,
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
            required: ["query"],
            additionalProperties: false,
        },
    },
    {
        name: "get_neighbours",
        description:
            "Walk one hop through the codebase graph from a file, symbol or node id: which modules import this one, what it imports, which module or cluster a symbol belongs to. Fast and free — no model runs. Use it while reading code to answer 'what depends on this' and 'what would a change here reach'. IMPORTANT: dependency edges are indexed at MODULE level, so a symbol anchor answers at the granularity of the module that defines it, and the tool tells you when it did that. Symbol-level call graphs (CALLS/IMPLEMENTS) are not indexed for most projects — an empty result is not proof that nothing references a symbol, and the response says so explicitly. Read the notes before concluding anything from an empty answer. Usable at ANY point in a session and as often as you like — it is a graph lookup, not a search.",
        inputSchema: {
            type: "object",
            properties: {
                project: PROJECT_ARG,
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
                    description:
                        "Restrict to these edge types. Omit for all of them (recommended). Reliably indexed: IMPORTS and DEPENDS_ON (module/cluster level), CONTAINS (module → symbol), MEMBER_OF (module → cluster). The rest are part of the schema but are usually empty, so filtering to them returns nothing.",
                },
                direction: {
                    type: "string",
                    enum: ["out", "in", "both"],
                    description:
                        "'out' = what the anchor points at (callees, imports); 'in' = what points at it (callers, importers — the blast radius); 'both' is the default.",
                },
                limit: { type: "integer", description: "Cap on neighbours per anchor. Default 25." },
            },
            // Nothing is required by schema: `project` is optional by design, and
            // the anchor is one-of symbol/file/node_id, which JSON Schema cannot
            // express here — the tool checks it and reports back to the model.
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
            const { base, evidence } = await service.locate(optionalString(args, "project"), query, readHints(args))
            return textResult(renderEvidence(base.repoFullName || base.name, query, evidence))
        }

        case "get_neighbours": {
            const nodeId = optionalString(args, "node_id")
            const symbol = optionalString(args, "symbol")
            const file = optionalString(args, "file")
            if (!nodeId && !symbol && !file) {
                throw new Error(`"symbol", "file" or "node_id" is required — one of them anchors the walk`)
            }
            const { base, graph } = await service.neighbours(optionalString(args, "project"), {
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
    return `Available knowledge bases (${bases.length}):\n${lines.join("\n")}\n\nPass one of these to locate_files or get_neighbours as "project" — or omit "project" entirely if only one of them is indexed. A git remote URL works too.`
}

function renderEvidence(
    project: string,
    query: string,
    evidence: Awaited<ReturnType<KnowledgeBaseService["locate"]>>["evidence"],
): string {
    const out: string[] = [`# Where "${query}" lives in ${project}`]

    if (evidence.files.length === 0) {
        return `${out[0]}\n\nThe retriever found nothing relevant. Rephrase in terms of observable behaviour and call locate_files again — an empty answer usually means the query was worded as keywords rather than as a change you intend. If a second wording also comes back empty, fall back to reading the repository directly.`
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

    // The closing line names what is still OPEN, not just what to do with what
    // came back. A result that reads as complete gets treated as complete — the
    // model reads the top files and never calls again, falling back to grep for
    // the rest of the task. Naming the dropped tail and the next question keeps
    // the door open, which is the whole point: this tool is worth calling several
    // times per task and once per task is the failure mode.
    const dropped = evidence.files.length - MAX_FILES
    const next = [
        `\nNext: read the top files above. Follow the code from there with get_neighbours — one graph hop, no model, no cost — rather than grepping.`,
    ]
    if (dropped > 0) {
        next.push(
            `${dropped} lower-ranked file${dropped === 1 ? "" : "s"} were not shown: if the ones above don't hold the answer, call locate_files again with a narrower query instead of falling back to search.`,
        )
    }
    next.push(
        `Call locate_files again for the next question this task raises — a new sub-question, a term you can't place, or another subsystem the change touches. It is not a once-per-session step.`,
    )
    out.push(next.join(" "))

    // Deliberately NOT rendered: the retrieval's cost and wall-clock. Printing
    // "$0.031 · 12.4s" into the model's context taught it that the call is
    // expensive, so it made one and then quietly reverted to grep — which merely
    // *feels* free. The numbers belong in usage telemetry and the UI, where the
    // person paying for them can see them, not in the reasoning of the caller
    // we want calling more often.

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
        .map(
            (a) =>
                `- ${a.name} (${a.kind})${a.file ? ` — ${a.file}${a.line ? `:${a.line}` : ""}` : ""}${
                    a.via ? `  [added automatically: ${a.via}]` : ""
                }`,
        )
        .join("\n")
    out.push(`\n## Anchored on\n${anchored}`)

    // An empty list is the one result that must never be shipped bare: read as
    // "nothing references this", it is exactly the wrong answer before a
    // refactor. The analyser's notes say whether the edges are absent or merely
    // unindexed, so lead with them.
    if (graph.neighbours.length === 0) {
        const why = graph.notes.length
            ? graph.notes.map((n) => `- ${n}`).join("\n")
            : "- No neighbours over the requested edges, and the analyser gave no reason. Do not read this as 'nothing references this'."
        out.push(`\n## No neighbours returned — read this before concluding anything\n${why}`)
        out.push(`\nRetry with direction "both" and no edge filter, or fall back to searching the repository.`)
        return out.join("\n")
    }

    // A non-empty answer can still be the wrong one — e.g. every row reached
    // over CONTAINS/MEMBER_OF, which says where the code lives, not what uses
    // it. The analyser flags that; surface it above the results, not below,
    // because a reader who has already scanned the list has drawn the
    // conclusion.
    if (graph.notes.length) {
        out.push(`\n## Read this first\n${graph.notes.map((n) => `- ${n}`).join("\n")}`)
    }

    // Grouped by EDGE, not by node kind: the relationship is the answer here.
    // "IMPORTS" is a list of dependents; "CONTAINS" is just the module that
    // declares the anchor. Grouping by node kind put those in the same bucket
    // and let a structural hit pass for a dependency.
    const groups = new Map<string, typeof graph.neighbours>()
    for (const n of graph.neighbours.slice(0, MAX_NEIGHBOURS)) {
        const key = n.edge || "related"
        const list = groups.get(key) ?? []
        list.push(n)
        groups.set(key, list)
    }
    for (const [edge, nodes] of groups) {
        const rows = nodes.map((n) => {
            const where = n.file ? `${n.file}${n.line ? `:${n.line}` : ""}` : ""
            const summary = clampSummary(n.summary)
            // `via` matters when the walk ran from more than one anchor: a hit
            // through the containing module is an importer of that MODULE, not
            // a caller of the symbol you asked about.
            const via = n.via ? `  [via ${n.via}]` : ""
            return `- ${n.name} (${n.kind})${where ? `  — ${where}` : ""}${via}${summary ? `\n    ${summary}` : ""}`
        })
        out.push(`\n## ${edge} (${nodes.length})\n${rows.join("\n")}`)
    }
    if (graph.neighbours.length > MAX_NEIGHBOURS) {
        out.push(`\n… ${graph.neighbours.length - MAX_NEIGHBOURS} more`)
    }
    if (graph.truncated) {
        out.push(`\n_Hit the per-anchor limit — narrow with \`edges\` or \`direction\` for the full picture._`)
    }
    out.push(
        `\nAnother hop costs nothing: call get_neighbours again on any row above (pass its \`node_id\` for an exact anchor) whenever you need to know what a piece of this reaches or who depends on it.`,
    )
    return out.join("\n")
}
