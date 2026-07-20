// /issues/compose (AI draft from a paragraph + images) and /embeddings.

import { AnalyserError, assertConfigured, authHeader } from "./client"

export type IssueComposePriority = "low" | "medium" | "high" | "urgent"
export type IssueComposeConfidence = "low" | "medium" | "high"
/** Architecture boundary the issue sits at. The analyser chooses one
 *  value from this controlled vocabulary; matched against the project
 *  layer-tag pool by find_similar_projects. */
export type IssueComposeLayer =
    | "frontend" | "backend" | "api"
    | "database" | "infra" | "mobile" | "shared"
export type IssueComposeAction =
    | "bug" | "feature" | "refactor" | "performance" | "security" | "test" | "docs"
export type IssueComposeScope = "local" | "cross-repo" | "system-wide"

export interface IssueComposeProposal {
    title:      string
    body:       string
    priority:   IssueComposePriority
    labels:     string[]
    confidence: IssueComposeConfidence
    /** Optional 1–2 sentence domain/surface restatement produced by
     *  the analyser solely for routing — meant to be embedded and
     *  compared against project-summary facets. Older analyser
     *  builds may omit this; callers should fall back to
     *  issueEmbeddingText(proposal) when it's missing or empty. */
    routing_summary?: string
    /** Architecture boundary. Embedded and compared against the
     *  project's layer-tag pool. Optional only because older analyser
     *  builds omit it; new builds always set a value. */
    layer?: IssueComposeLayer | string
    /** Hierarchical "domain/subdomain" tags (e.g. "auth/login",
     *  "billing/invoice"). 1-3 entries. Joined for the feature
     *  embedding query. */
    features?: string[]
    /** What kind of work this is. Not currently used in routing
     *  weights but surfaced for UI display + future filters. */
    action?: IssueComposeAction | string
    /** How wide the impact is. Hint for the routing UI to pre-select
     *  multiple targets when scope = "cross-repo". */
    scope?: IssueComposeScope | string
    model:      string
    duration_ms: number
    usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
}

export interface IssueComposeInput {
    paragraph: string
    /** Each image must already be a `data:image/...;base64,…` URI
     *  (compress on the client first via lib/util/image-compress.ts). */
    images?: string[]
}

export async function composeIssue(input: IssueComposeInput): Promise<IssueComposeProposal> {
    const { http } = assertConfigured()
    const res = await fetch(`${http}/issues/compose`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader() },
        body: JSON.stringify({ paragraph: input.paragraph, images: input.images ?? [] }),
    })
    if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        const err = body?.error || {}
        throw new AnalyserError(err.message || `compose failed: HTTP ${res.status}`, err.code || "compose_failed")
    }
    return (await res.json()) as IssueComposeProposal
}

export interface EmbedResult {
    vector:     number[]
    dimensions: number
    model:      string
    usage: { prompt_tokens: number; total_tokens: number }
}

export async function embedText(text: string): Promise<EmbedResult> {
    const { http } = assertConfigured()
    const res = await fetch(`${http}/embeddings`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader() },
        body: JSON.stringify({ text }),
    })
    if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        const err = body?.error || {}
        throw new AnalyserError(err.message || `embed failed: HTTP ${res.status}`, err.code || "embed_failed")
    }
    return (await res.json()) as EmbedResult
}
