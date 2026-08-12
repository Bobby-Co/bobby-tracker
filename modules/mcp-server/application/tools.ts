// MCP server — the tool catalogue: what Claude sees in `tools/list`, and how each
// call is executed and rendered.
//
// The whole point of these tools is to REPLACE exploratory file reading. A model
// that would otherwise grep a repo and open a dozen files to find the three that
// matter can instead ask `locate_files` once and get the coordinates. So the
// rendering here is deliberately terse and scannable: ranked paths, then cited
// `file:line` bodies, and hard caps on every list. Verbose output would spend the
// tokens the tool exists to save.

import type { KnowledgeBaseService } from "./KnowledgeBaseService"
import type { RetrieveHints } from "@/modules/analysis"
import { type McpToolDefinition, type McpToolResult, textResult } from "../domain/McpTool"

// Output caps. Generous enough to answer the question, small enough that a call
// stays far cheaper than reading the files it points at.
const MAX_HEAT = 12
const MAX_PINPOINTS = 8
const MAX_PINPOINT_LINES = 40
const MAX_SYMBOLS = 20
const MAX_NOTES = 6

export const TOOL_DEFINITIONS: McpToolDefinition[] = [
    {
        name: "list_knowledge_bases",
        description:
            "List the Ocelot knowledge bases (indexed codebases) you can query. Call this first when you don't know which project name to pass to the other tools, or to check whether the current repository has one.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
        name: "locate_files",
        description:
            "Find which files implement a feature, behaviour or bug in an indexed codebase, WITHOUT reading the repository. Returns ranked files plus exact file:line snippets of the relevant functions. Use this before grepping or opening files: ask in plain language (e.g. 'where is the OAuth token refreshed?'), then read only the files it points at.",
        inputSchema: {
            type: "object",
            properties: {
                project: {
                    type: "string",
                    description: "Which knowledge base: 'owner/repo', the repo name, or the Ocelot project name.",
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
        name: "ask_codebase",
        description:
            "Ask a question about how an indexed codebase works and get a grounded answer with citations. Use for architecture and 'how/why does X work' questions; use locate_files when you need the specific files to edit.",
        inputSchema: {
            type: "object",
            properties: {
                project: {
                    type: "string",
                    description: "Which knowledge base: 'owner/repo', the repo name, or the Ocelot project name.",
                },
                question: { type: "string", description: "The question to answer about the codebase." },
            },
            required: ["project", "question"],
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

/** Trim a pinpoint body so one oversized function can't dominate the response. */
function clampBody(body: string): string {
    const lines = body.split("\n")
    if (lines.length <= MAX_PINPOINT_LINES) return body
    return [...lines.slice(0, MAX_PINPOINT_LINES), `… (${lines.length - MAX_PINPOINT_LINES} more lines)`].join("\n")
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
            const { base, evidence } = await service.locate(
                requireString(args, "project"),
                requireString(args, "query"),
                readHints(args),
            )
            return textResult(renderEvidence(base.repoFullName || base.name, requireString(args, "query"), evidence))
        }

        case "ask_codebase": {
            const { base, answer } = await service.ask(requireString(args, "project"), requireString(args, "question"))
            return textResult(renderAnswer(base.repoFullName || base.name, answer))
        }

        default:
            throw new Error(`unknown tool "${name}"`)
    }
}

// ─── rendering ───────────────────────────────────────────────────────────────
function renderList(bases: Awaited<ReturnType<KnowledgeBaseService["list"]>>): string {
    if (bases.length === 0) {
        return "No knowledge bases are available to you.\n\nTo expose one: open the project in Ocelot → Integrations tab → enable MCP access. The project also needs to have finished indexing."
    }
    const lines = bases.map((b) => {
        const label = b.repoFullName ? `${b.repoFullName} (${b.name})` : b.name
        const state = b.indexed ? "" : "  — NOT INDEXED YET, cannot be queried"
        const desc = b.description ? `\n    ${b.description}` : ""
        return `- ${label}${state}${desc}`
    })
    return `Available knowledge bases (${bases.length}):\n${lines.join("\n")}\n\nPass one of these to locate_files or ask_codebase as "project".`
}

function renderEvidence(
    project: string,
    query: string,
    evidence: Awaited<ReturnType<KnowledgeBaseService["locate"]>>["evidence"],
): string {
    const out: string[] = [`# Where "${query}" lives in ${project}`]

    if (evidence.heat.length === 0 && evidence.pinpoints.length === 0) {
        return `${out[0]}\n\nThe retriever found nothing relevant. Try rephrasing in terms of observable behaviour, or fall back to reading the repository directly.`
    }

    if (evidence.heat.length > 0) {
        const rows = evidence.heat.slice(0, MAX_HEAT).map((h, i) => {
            const opens = h.opens ? `, ${h.opens} opens` : ""
            return `${i + 1}. ${h.file}  (score ${h.score.toFixed(2)}${opens})`
        })
        const more = evidence.heat.length > MAX_HEAT ? `\n… ${evidence.heat.length - MAX_HEAT} more` : ""
        out.push(`\n## Ranked files\n${rows.join("\n")}${more}`)
    }

    if (evidence.pinpoints.length > 0) {
        const blocks = evidence.pinpoints.slice(0, MAX_PINPOINTS).map((p) => {
            const where = p.line ? `${p.file}:${p.line}` : p.file
            const what = [p.symbol, p.label].filter(Boolean).join(" — ")
            const head = what ? `### ${where} — ${what}` : `### ${where}`
            return p.body ? `${head}\n\`\`\`\n${clampBody(p.body)}\n\`\`\`` : head
        })
        const more = evidence.pinpoints.length > MAX_PINPOINTS ? `\n… ${evidence.pinpoints.length - MAX_PINPOINTS} more` : ""
        out.push(`\n## Pinpoints\n${blocks.join("\n\n")}${more}`)
    }

    if (evidence.symbols.length > 0) {
        const rows = evidence.symbols.slice(0, MAX_SYMBOLS).map((s) => {
            const where = s.line ? `${s.file}:${s.line}` : s.file
            return `- ${s.name} → ${where}${s.kind ? ` (${s.kind})` : ""}`
        })
        out.push(`\n## Symbols\n${rows.join("\n")}`)
    }

    if (evidence.notes.length > 0) {
        out.push(`\n## Notes\n${evidence.notes.slice(0, MAX_NOTES).map((n) => `- ${n}`).join("\n")}`)
    }

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

function renderAnswer(project: string, answer: Awaited<ReturnType<KnowledgeBaseService["ask"]>>["answer"]): string {
    const out = [`# ${project}`, "", answer.markdown]
    if (answer.code_cites?.length) {
        const cites = answer.code_cites
            .slice(0, MAX_SYMBOLS)
            .map((c) => `- ${c.file}${c.line ? `:${c.line}` : ""}`)
            .join("\n")
        out.push(`\n## Cited code\n${cites}`)
    }
    return out.join("\n")
}
