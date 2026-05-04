// Thin OpenAI client used by the AI issue composer + similarity
// detection. Two surfaces:
//
//   - proposeIssue(): GPT-4.1-mini turns a free-text paragraph plus
//     0..N images into a structured issue draft (title, body,
//     priority, labels). JSON-schema response_format guarantees the
//     output shape — no parsing fragility.
//
//   - embedText(): text-embedding-3-small produces a 1536-dim vector
//     we store in tracker.issues.embedding for similarity search.
//
// We hit the REST API directly via fetch instead of pulling in the
// `openai` SDK — saves a dep, the call surface is small, and we can
// fail-soft cleanly when the API key isn't configured.

import { ISSUE_PRIORITIES, type IssuePriority } from "@/lib/supabase/types"

const OPENAI_BASE_URL = "https://api.openai.com/v1"

const PROPOSER_MODEL = "gpt-4.1-mini"
const EMBED_MODEL = "text-embedding-3-small"
const EMBED_DIM = 1536

export class OpenAIError extends Error {
    code: string
    status: number
    constructor(code: string, message: string, status = 502) {
        super(message)
        this.code = code
        this.status = status
    }
}

function apiKey(): string {
    const k = process.env.OPENAI_API_KEY
    if (!k) throw new OpenAIError("missing_api_key", "OPENAI_API_KEY isn't set on the server.", 500)
    return k
}

export interface IssueProposal {
    title: string
    body: string
    priority: IssuePriority
    labels: string[]
    /** Model's self-reported confidence in its draft. Surfaced as a
     *  hint to the user that they should review carefully. */
    confidence: "low" | "medium" | "high"
}

const PROPOSAL_SYSTEM = `You convert raw bug reports / feature ideas from end users into clean, actionable issue drafts for a software project.

Rules:
- Title: a single sentence, under 90 chars. Imperative or descriptive ("Login button unresponsive on mobile", not "There's a problem with logging in"). No period.
- Body: structured markdown. If it's a bug, include "Steps to reproduce", "Expected", "Actual" sections when the user gave enough detail. If it's a feature ask, summarize the problem and proposed direction. Stay close to the user's wording — do not invent specifics they didn't mention. If they referenced screenshots, describe what you see in the images.
- Priority: pick exactly one of "low", "medium", "high", "urgent" based on user-described impact. Default to "medium" when unclear. Reserve "urgent" for blocking / security / data-loss reports.
- Labels: 1 to 5 short kebab-case tags categorizing the report (e.g. "bug", "ui", "auth", "performance", "feature-request"). Be conservative — don't invent labels that aren't grounded in the input.
- Confidence: "low" when the user gave very little to work with, "high" when the report is detailed and unambiguous, otherwise "medium".

Never refuse. If the input is sparse, do your best and lower the confidence accordingly.`

interface ProposeInput {
    paragraph: string
    /** Each image is a data URI ("data:image/jpeg;base64,…"). */
    images?: string[]
}

// Build an OpenAI Chat user message with text + (optional) images.
function buildUserContent(input: ProposeInput) {
    const blocks: unknown[] = [
        { type: "text", text: input.paragraph || "(no text — see images)" },
    ]
    for (const url of input.images ?? []) {
        // detail:"low" caps the image at ~85 tokens regardless of
        // resolution. Vision quality is plenty for "is this a UI
        // bug screenshot" without burning tokens.
        blocks.push({ type: "image_url", image_url: { url, detail: "low" } })
    }
    return blocks
}

const proposalSchema = {
    name: "issue_proposal",
    schema: {
        type: "object",
        additionalProperties: false,
        required: ["title", "body", "priority", "labels", "confidence"],
        properties: {
            title:      { type: "string", maxLength: 200 },
            body:       { type: "string", maxLength: 10_000 },
            priority:   { type: "string", enum: ISSUE_PRIORITIES },
            labels:     { type: "array",  maxItems: 5, items: { type: "string", maxLength: 40 } },
            confidence: { type: "string", enum: ["low", "medium", "high"] },
        },
    },
    strict: true,
} as const

export async function proposeIssue(input: ProposeInput): Promise<IssueProposal> {
    if (!input.paragraph.trim() && (!input.images || input.images.length === 0)) {
        throw new OpenAIError("bad_input", "Need either a paragraph or at least one image.", 400)
    }

    const res = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey()}`,
        },
        body: JSON.stringify({
            model: PROPOSER_MODEL,
            messages: [
                { role: "system", content: PROPOSAL_SYSTEM },
                { role: "user", content: buildUserContent(input) },
            ],
            response_format: { type: "json_schema", json_schema: proposalSchema },
            // The drafts are short — a small cap protects us from the
            // model spinning out a multi-page body.
            max_completion_tokens: 1200,
            temperature: 0.3,
        }),
    })
    if (!res.ok) {
        const txt = await res.text().catch(() => "")
        throw new OpenAIError("openai_failed", `OpenAI ${res.status}: ${txt.slice(0, 300)}`, 502)
    }
    const data = await res.json() as {
        choices?: { message?: { content?: string } }[]
    }
    const raw = data.choices?.[0]?.message?.content
    if (!raw) throw new OpenAIError("empty_response", "OpenAI returned no content.", 502)

    let parsed: IssueProposal
    try { parsed = JSON.parse(raw) as IssueProposal }
    catch { throw new OpenAIError("invalid_json", "OpenAI returned non-JSON content.", 502) }

    return parsed
}

export async function embedText(text: string): Promise<number[]> {
    const trimmed = text.trim()
    if (!trimmed) throw new OpenAIError("bad_input", "Embedding input is empty.", 400)

    const res = await fetch(`${OPENAI_BASE_URL}/embeddings`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey()}`,
        },
        body: JSON.stringify({
            model: EMBED_MODEL,
            input: trimmed.slice(0, 8000),
        }),
    })
    if (!res.ok) {
        const txt = await res.text().catch(() => "")
        throw new OpenAIError("openai_failed", `Embeddings ${res.status}: ${txt.slice(0, 300)}`, 502)
    }
    const data = await res.json() as { data?: { embedding?: number[] }[] }
    const vec = data.data?.[0]?.embedding
    if (!vec || vec.length !== EMBED_DIM) {
        throw new OpenAIError("bad_embedding", `Expected ${EMBED_DIM}-dim vector, got ${vec?.length ?? 0}.`, 502)
    }
    return vec
}

// Compose the text we feed to the embedder. We concatenate title +
// body so similarity reflects what the issue is *about*, not just
// title overlap. Truncated to a generous slice to stay well under
// the embedding model's 8k input window.
export function issueEmbeddingText(issue: { title: string; body: string }): string {
    const body = (issue.body ?? "").trim()
    const title = (issue.title ?? "").trim()
    return `${title}\n\n${body}`.slice(0, 7500)
}
