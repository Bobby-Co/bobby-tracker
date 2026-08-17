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

/** Which analyser deployment an adapter instance talks to. Injected at
 *  construction (never read from env by the adapter) so one process can hold a
 *  handle to several cells' analysers at once.
 *
 *  `baseUrl` may be empty: that is how the registry reports "this cell has no
 *  analyser behind it". The adapter turns it into a loud not_configured error
 *  naming the cell, rather than falling back to another cell's URL. */
export interface AnalyserEndpoint {
    /** The cell this endpoint serves — carried for error messages only. */
    cell: string
    baseUrl: string
    token: string
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

// ─── /retrieve ───────────────────────────────────────────────────────────────
// The goal-agnostic retrieval engine WITHOUT the synthesis pass and WITHOUT any
// source: ranked file cards — where to look, why, and the module/cluster prose
// the graph baked at index time. This is what the MCP `locate_files` tool
// serves. The consumer is a coding agent with its own file reader, so returning
// code bodies would bill the same tokens twice; coordinates plus the graph's
// judgement is what it can't get for itself.

/** Optional anchors the caller already knows, to seed the walk. */
export interface RetrieveHints {
    symbols?: string[]
    files?: string[]
}

export interface RetrieveInput {
    repoId: string
    query: string
    hints?: RetrieveHints
    maxBudgetUsd?: number
    maxAgents?: number
    /** Cap on ranked file cards. Defaults to 12 analyser-side. */
    maxFiles?: number
    /** The calling user's auth uuid, forwarded as X-Bobby-User so the analyser
     *  can attribute the cost. Without it the analyser falls back to the shared
     *  service token, which is not a uuid and cannot be attributed. */
    userId?: string
}

/** One definition inside a ranked file. */
export interface RetrieveFileSymbol {
    name: string
    kind?: string
    signature?: string
    line?: number
}

/** A ranked file card. `score`/`opens` are the swarm's attention signal, `why`
 *  the human-readable reasons it ranked, and module/cluster the indexed context
 *  around it. */
export interface RetrieveFile {
    file: string
    score: number
    opens?: number
    why?: string[]
    language?: string
    module?: string
    module_summary?: string
    cluster?: string
    cluster_summary?: string
    symbols?: RetrieveFileSymbol[]
}

export interface RetrieveSymbol {
    name: string
    file: string
    line?: number
    kind?: string
}

export interface RetrieveResult {
    files: RetrieveFile[]
    symbols: RetrieveSymbol[]
    notes: string[]
    clusters: { label: string; score?: number }[]
    stats?: {
        agents_run?: number
        clusters_visited?: number
        cost_usd?: number
        duration_ms?: number
    }
}

// ─── /neighbours ─────────────────────────────────────────────────────────────
// One hop through the knowledge graph, no model in the loop. Backs the MCP
// `get_neighbours` tool: once a caller is reading code, "what calls this", "what
// does this import", "what implements this" are single indexed hops.

export interface NeighboursInput {
    repoId: string
    /** Exactly one anchor; most specific wins (nodeId > symbol > file). */
    nodeId?: string
    symbol?: string
    file?: string
    /** IMPORTS | CALLS | IMPLEMENTS | EXTENDS | CONTAINS | DEFINES | MEMBER_OF |
     *  MENTIONS | DEPENDS_ON. Empty = every edge kind. */
    edges?: string[]
    /** "out" | "in" | "both". Defaults to "both" analyser-side. */
    direction?: string
    limit?: number
    /** The calling user's auth uuid — see RetrieveInput.userId. */
    userId?: string
}

export interface NeighbourNode {
    id: string
    kind: string
    name: string
    file?: string
    line?: number
    signature?: string
    summary?: string
    language?: string
    /** On an anchor: why it is in the set ("defines resolvePublicSession").
     *  On a neighbour: which anchor it was reached from. */
    via?: string
    /** The edge this neighbour was reached over. IMPORTS = a dependent;
     *  CONTAINS/MEMBER_OF = where the code lives, not what uses it. */
    edge?: string
}

export interface NeighboursResult {
    anchors: NeighbourNode[]
    neighbours: NeighbourNode[]
    /** Why the answer looks the way it does — ALWAYS rendered, and load-bearing
     *  when `neighbours` is empty: an empty list means "no such edges indexed"
     *  at least as often as it means "nothing references this". */
    notes: string[]
    /** At least one anchor hit the per-anchor limit — narrow by edge kind. */
    truncated?: boolean
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

export interface ChatHistoryMessage {
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

/** Who to bill for a one-shot AI call (`/issues/compose`, `/embeddings`).
 *
 *  `teamId` is the billing subject and the ONLY reliable identifier here:
 *  compose runs before an issue has a project, and both endpoints can be called
 *  against a project that was never indexed — which has no `project_analyser`
 *  row for the analyser to resolve a team from. `projectId` is attribution when
 *  the caller knows it.
 *
 *  Always pass the teamId the route's own guard returned, never one from the
 *  request body — the analyser trusts this field (see UsageReport.TeamID there). */
/** The ledger label. Defaults to the endpoint's own kind (`compose` / `embed`);
 *  set it when the SAME endpoint serves a distinct product the bill should name
 *  separately — today that is public issue reporting, where the spend is a
 *  visitor's but the bill is the publishing team's, and lumping it in with a
 *  member's own drafting would make it unexplainable on the billing page.
 *
 *  The analyser allowlists these, so a value it doesn't know is silently recorded
 *  under the endpoint default rather than rejected. Keep in step with the `KIND`
 *  map in components/settings/billing-panel.tsx, which renders the labels. */
export type AnalyserUsageKind = "compose" | "embed" | "public_issue"

type BillingCommon = { userId?: string; usageKind?: AnalyserUsageKind }

export type AnalyserBilling =
    | ({ teamId: string; projectId?: string } & BillingCommon)
    /** projectId-only is allowed because the analyser can still resolve the team
     *  from `project_analyser` — but ONLY for a project that has been indexed.
     *  Prefer the teamId form wherever the guard already handed you one. */
    | ({ teamId?: string; projectId: string } & BillingCommon)

export interface IssueComposeInput {
    paragraph: string
    /** Each image must already be a `data:image/...;base64,…` URI. */
    images?: string[]
    billing?: AnalyserBilling
}

export interface EmbedResult {
    vector:     number[]
    dimensions: number
    model:      string
    usage: { prompt_tokens: number; total_tokens: number }
}

// ─── /pr/analyse + deep-dive ──────────────────────────────────────────────────
export interface PrAnalyseFile {
    path: string
    previous_path?: string
    status?: string
    patch?: string
    additions?: number
    deletions?: number
}

export interface PrAnalyseInput {
    repoId:  string
    number:  number
    title:   string
    body?:   string
    baseSha?: string
    headSha?: string
    files:   PrAnalyseFile[]
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
    // Seedability — whether RETRIEVAL can start on this graph, which is separate
    // from note quality and fails on its own. The swarm is seeded from Module
    // nodes' embeddings; with none, issue analysis, PR review and the MCP tools
    // all return empty results while every other metric still reads healthy.
    // `seedable: false` means the graph needs re-indexing. Optional because an
    // older analyser build won't send them.
    modules_indexed?: number
    modules_sampled?: number
    modules_with_embedding?: number
    embedding_rate?: number
    seedable?: boolean
    seedability_note?: string
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
