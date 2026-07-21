// Analysis port — the bobby-analyser wire contract: the DTOs the Analyser port
// speaks in, plus the error it rejects with and the detached-run callback shape.
// Neutral data owned by the port layer (the vcs VcsTypes precedent); the HTTP
// transport that produces/consumes them lives in infrastructure/HttpAnalyser.

import type { AnalyseEffort } from "../domain/ProjectAnalyser"
export type { AnalyseEffort }

/** Thrown by the Analyser adapter on any transport/protocol failure. */
export class AnalyserError extends Error {
    constructor(message: string, public readonly code: string = "analyser_error") {
        super(message)
    }
}

/** Where a detached run POSTs its terminal result. `token` (when set) is sent as
 *  `Authorization: Bearer <token>` on the callback. */
export interface AnalyserRunCallback {
    url: string
    token?: string
}

/** What deepDivePRInsight materialises: a fresh chat conversation seeded with the
 *  stored PR insight's context (analyser ADR-0055). */
export interface DeepDiveResult {
    conversation_id: string
    repo_id?: string
    project_id?: string
    pr_number?: number
    pr_title?: string
}

// ─── /query ──────────────────────────────────────────────────────────────────
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

// ─── /chat (SSE) ─────────────────────────────────────────────────────────────
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
    issues?: ChatIssue[]
    route?: string[]
    open_issue_id?: string
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

// ─── /issues/analyse + /issues/preferences ───────────────────────────────────
export interface IssueFinding {
    file:        string
    line?:       number
    symbol?:     string
    reason:      string
    confidence?: "high" | "medium" | "low" | string
}

export interface IssueAnalysis {
    summary:      string
    suggestions:  IssueFinding[]
    confidence?:  "high" | "medium" | "low" | string
    graph_cites?: string[]
    stop_reason?: string
    cost_usd:     number
    duration_ms:  number
    tool_calls?:  number
    markdown?:    string
    /** True when the swarm that produced these suggestions ran on a
     *  locally-served model; false for cloud/remote. Always present on the wire
     *  (defaults false) — do NOT infer from cost_usd. */
    local:        boolean
}

export interface IssueAnalyseInput {
    repoId:        string
    title:         string
    body?:         string
    labels?:       string[]
    priority?:     string
    maxBudgetUsd?: number
    /** Thoroughness level. Omit to let the analyser fall back to the project's
     *  saved default, then its own server default. */
    effort?:       AnalyseEffort
    /** Authenticated user id. Sent as X-Bobby-User so the analyser can route the
     *  ensemble swarm to this user's connected local-model relay worker. */
    userId?:       string
}

export interface IssuePreferences {
    repo_id: string
    /** The saved default effort, or "" when no default has been set. */
    effort:  AnalyseEffort | ""
}

// ─── /issues/compose + /embeddings ────────────────────────────────────────────
export type IssueComposePriority = "low" | "medium" | "high" | "urgent"
export type IssueComposeConfidence = "low" | "medium" | "high"
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
    routing_summary?: string
    layer?: IssueComposeLayer | string
    features?: string[]
    action?: IssueComposeAction | string
    scope?: IssueComposeScope | string
    model:      string
    duration_ms: number
    usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
}

export interface IssueComposeInput {
    paragraph: string
    /** Each image must already be a `data:image/...;base64,…` URI. */
    images?: string[]
}

export interface EmbedResult {
    vector:     number[]
    dimensions: number
    model:      string
    usage: { prompt_tokens: number; total_tokens: number }
}

// ─── /pr/analyse + deep-dive ──────────────────────────────────────────────────
export interface PRAnalyseFile {
    path: string
    previous_path?: string
    status?: string
    patch?: string
    additions?: number
    deletions?: number
}

export interface PRAnalyseInput {
    repoId:  string
    number:  number
    title:   string
    body?:   string
    baseSha?: string
    headSha?: string
    files:   PRAnalyseFile[]
    maxBudgetUsd?: number
    /** Tracker project uuid — persisted with the insight + scopes the deep-dive. */
    projectId?: string
    /** Relay routing (X-Bobby-User); ignored when no worker is connected. */
    userId?: string
}

// ─── /verify ─────────────────────────────────────────────────────────────────
export interface VerifyBrokenCite {
    note_path: string
    file: string
    line?: number
    reason: "file_not_found" | "line_out_of_range" | "empty_file" | string
}

export interface VerifyStaleNote {
    path: string
    last_commit: string
    /** -1 means the SHA isn't reachable from HEAD in this clone (treat as unknown). */
    commits_behind: number
}

export interface VerifyContentStaleNote {
    path: string
    last_commit: string
    changed_cited_files: string[]
}

export interface VerifyReport {
    generated_at: string
    head_sha: string
    notes: number
    notes_by_kind: Record<string, number>
    citations_total: number
    citations_resolved: number
    citations_broken?: VerifyBrokenCite[]
    hit_rate: number
    drift_median: number
    drift_max: number
    drift_buckets: Record<string, number>
    stalest_notes?: VerifyStaleNote[]
    indexed_files: number
    covered_files: number
    uncovered_files?: string[]
    uncovered_total: number
    coverage_rate: number
    content_stale_notes?: VerifyContentStaleNote[]
    content_stale_total: number
    overall_health: number
}

export interface VerifyInput {
    repoUrl: string
    repoId: string
    repoRef?: string
    /** auth.users UUID whose stored GitHub token the analyser worker fetches to
     *  clone private repos. The preferred path — the token never crosses the wire. */
    userId?: string
    /** Optional explicit clone credential. Honored over userId; an escape hatch. */
    gitToken?: string
    maxBrokenSamples?: number
}

// ─── /jobs/run (indexing kickoff) ─────────────────────────────────────────────
export interface SupabaseProgressTarget {
    /** Row key — the only piece the tracker sends. Connection details are
     *  configured on the analyser server so secrets stay off the wire. */
    key_value: string
}

export interface KickoffJobInput {
    job_type?: "bootstrap" | "incremental"
    repo_url: string
    repo_ref?: string
    repo_id?: string
    effort?: "low" | "medium" | "high"
    only_lang?: string[]
    max_budget_usd?: number
    concurrency?: number
    /** auth.users UUID whose stored GitHub token the analyser worker fetches to
     *  clone private repos. Preferred over git_auth — the token never crosses the wire. */
    user_id?: string
    git_auth?: { token: string; username?: string; scheme?: "basic" | "bearer" }
    supabase_progress: SupabaseProgressTarget
}

export interface KickoffResult {
    job_id: string
    status: "accepted"
    runner: string
    version: string
    hostname?: string
}
