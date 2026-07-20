// /query (request/response) and /chat (SSE streaming).

import { AnalyserError, assertConfigured, authHeader } from "./client"

export interface QueryResult {
    markdown: string
    graph_cites?: string[]
    code_cites?: { file: string; line?: number }[]
    confidence?: string
    stop_reason?: string
    cost_usd: number
    duration_ms: number
    tool_calls?: number
}

export async function ask(repoId: string, question: string, maxBudgetUsd?: number): Promise<QueryResult> {
    const { http } = assertConfigured()
    const res = await fetch(`${http}/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader() },
        body: JSON.stringify({ repo_id: repoId, question, max_budget_usd: maxBudgetUsd }),
    })
    if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        const err = body?.error || {}
        throw new AnalyserError(err.message || `query failed: HTTP ${res.status}`, err.code || "query_failed")
    }
    return (await res.json()) as QueryResult
}

export interface ChatCitation {
    file: string
    line?: number
    valid: boolean
}

// ChatIssue is a tracker issue the analyser's finaliser surfaced/cited for a
// turn (analyser ADR-0048). `cited` marks the ones referenced inline; the UI
// loads the issue by `id` (uuid) and shows `#number`.
export interface ChatIssue {
    id: string
    number?: number
    title: string
    status?: string
    similarity?: number
    cited: boolean
}

export interface ChatResult {
    answer_markdown: string
    citations: ChatCitation[]
    issues?: ChatIssue[] // related/cited tracker issues (ADR-0048)
    route?: string[] // actions the thinker chose: answer|codebase|issues
    open_issue_id?: string // agent asks the UI to auto-open this issue in the tray
    confidence: string
    cost_usd: number
    duration_ms: number
    agents_run: number
    local?: boolean
}

export interface ChatHistoryMsg {
    role: "user" | "assistant"
    content: string
}

// chatStream opens the analyser's streaming /chat endpoint (Server-Sent Events)
// and returns the raw fetch Response so the caller can pipe `response.body`
// straight through to the browser. The body is text/event-stream with frames
// `event: <type>\ndata: <json>\n\n` where type ∈ {stage, activity, answer, error}.
export async function chatStream(
    repoId: string,
    question: string,
    history?: ChatHistoryMsg[],
    maxBudgetUsd?: number,
    projectId?: string,
    conversationId?: string,
): Promise<Response> {
    const { http } = assertConfigured()
    const res = await fetch(`${http}/chat`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Accept: "text/event-stream",
            ...authHeader(),
        },
        // project_id scopes the thinker's "issues" action to this project's
        // embedded issues (analyser ADR-0048). conversation_id keys the durable
        // managed-context store the background context agent maintains
        // (ADR-0049); history is the short temporal buffer. Both distinct from
        // repo_id (the graph id).
        body: JSON.stringify({
            repo_id: repoId,
            project_id: projectId,
            conversation_id: conversationId,
            question,
            history,
            max_budget_usd: maxBudgetUsd,
        }),
    })
    if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}))
        const err = body?.error || {}
        throw new AnalyserError(err.message || `chat failed: HTTP ${res.status}`, err.code || "chat_failed")
    }
    return res
}
