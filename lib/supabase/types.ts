// Database row types for the tracker schema. Hand-written so we don't pull
// in the supabase CLI codegen toolchain just for Phase 2; regenerate with
// `supabase gen types typescript --schema tracker` once the schema settles.

export type IssueStatus = "open" | "in_progress" | "blocked" | "done" | "archived" | "duplicated"
export type IssuePriority = "low" | "medium" | "high" | "urgent"
export type AnalyserStatus = "disabled" | "pending" | "indexing" | "ready" | "failed"

export interface Project {
    id: string
    user_id: string
    name: string
    repo_url: string
    repo_full_name: string | null
    description: string | null
    created_at: string
    updated_at: string
}

export interface Issue {
    id: string
    project_id: string
    user_id: string
    title: string
    body: string
    status: IssueStatus
    priority: IssuePriority
    labels: string[]
    github_issue_number: number | null
    github_node_id: string | null
    issue_number: number
    /** When this issue was filed via the AI composer flow rather than
     *  the bare new-issue form. Surfaces an "AI" badge in lists. */
    ai_proposed: boolean
    /** When the submitter flagged this as a duplicate of another
     *  issue at create-time. The original is still persisted (we
     *  never drop user reports), but UIs treat it as a satellite. */
    duplicate_of_issue_id: string | null
    created_at: string
    updated_at: string
}

/** Per-project toggle for the public-submissions integration.
 *  A project must be enabled here before it can be added to a
 *  public session (enforced by DB trigger). */
export interface ProjectPublicIntegration {
    project_id: string
    enabled: boolean
    created_at: string
    updated_at: string
}

/** Embedding vector for an issue. Lives in its own table
 *  (migration 0015) so the heavy float[] doesn't ride along with
 *  every issue read, and so a re-embed sweep can target rows by
 *  model name. One row per indexed issue; rows without an
 *  embedding simply don't appear here. */
export interface IssueEmbedding {
    issue_id: string
    embedding: number[]
    model: string
    created_at: string
    updated_at: string
}

/** Reporter identity for a publicly-submitted issue. One row per
 *  public-submission issue; owner-filed issues never have one. */
export interface PublicIssueReporter {
    issue_id: string
    reporter_id: string | null
    reporter_name: string | null
    session_id: string | null
    /** Captured when the submitter was authenticated at submission
     *  time (always set in invite-mode sessions). Used to enforce the
     *  'own'-visibility filter across browsers. */
    auth_user_id: string | null
    created_at: string
}

export interface AnalyserProgress {
    phase?: string         // human-readable phase label
    slug?: string          // current module slug being processed
    step_idx?: number      // 1-based progress through phase 2 modules
    step_total?: number
    cost_usd?: number      // cumulative spend so far
    started_at?: string    // ISO timestamp the run began
    message?: string       // any one-liner the server wants to surface
}

export interface ProjectAnalyser {
    project_id: string
    enabled: boolean
    status: AnalyserStatus
    graph_id: string | null
    last_indexed_at: string | null
    last_indexed_sha: string | null
    last_index_cost_usd: number | null
    last_error: string | null
    progress: AnalyserProgress | null
    /** Latest verify.Report on the graph. Updated by manual verify
     * button + post-update QC + post-bootstrap QC. Null until first run. */
    last_health_report: unknown | null
    /** Timestamp of the verify run that wrote last_health_report. */
    last_health_check_at: string | null
    /** Human-readable rollup of the project's stack, modules, and
     * surfaces. Refreshed by bobby-analyser on every successful
     * bootstrap / incremental update; powers the project-groups UI
     * + AI compose's "which project does this issue belong to?"
     * routing. Null until the first index. */
    summary_markdown: string | null
    /** 1536-dim vector from text-embedding-3-small over
     *  summary_markdown. Used for cosine similarity against issue-
     *  draft embeddings inside a project group. */
    summary_embedding: number[] | null
    /** Embedding model that produced summary_embedding. */
    summary_model: string | null
    /** When summary_markdown + summary_embedding were last refreshed. */
    summary_updated_at: string | null
    updated_at: string
}

export interface IssueFinding {
    file: string
    line?: number
    symbol?: string
    reason: string
    confidence?: string
}

export interface IssueAnalysisData {
    summary: string
    suggestions: IssueFinding[]
    confidence?: string
    graph_cites?: string[]
    stop_reason?: string
    cost_usd?: number
    duration_ms?: number
    tool_calls?: number
    markdown?: string
}

export interface IssueSuggestion {
    id: string
    issue_id: string
    // Structured analysis from /issues/analyse. Null for legacy rows
    // produced by the old /query path — those used the markdown column.
    data: IssueAnalysisData | null
    markdown: string
    code_cites: { file: string; line?: number }[]
    graph_cites: string[]
    confidence: string | null
    cost_usd: number | null
    duration_ms: number | null
    graph_id: string | null
    created_at: string
}

export const ISSUE_STATUSES: IssueStatus[] = ["open", "in_progress", "blocked", "done", "archived", "duplicated"]
export const ISSUE_PRIORITIES: IssuePriority[] = ["low", "medium", "high", "urgent"]

/** Who can open the public link.
 *  - 'link'   — anyone with the URL (default)
 *  - 'invite' — only signed-in users whose email is whitelisted */
export type PublicSessionAccessMode = "link" | "invite"

/** Who can see other submitters' submissions on the public listing.
 *  - 'all' (default) — everyone sees every submission.
 *  - 'own' — each submitter only sees their own. */
export type PublicSessionSubmissionsVisibility = "all" | "own"

/** Standalone shareable session that can cover one or more projects.
 *  Replaces the old per-project ProjectPublicSession (migration 0009). */
export interface PublicSession {
    id: string
    user_id: string
    token: string
    enabled: boolean
    access_mode: PublicSessionAccessMode
    submissions_visibility: PublicSessionSubmissionsVisibility
    /** Internal label shown in the owner's session list. */
    name: string
    /** Public heading rendered to submitters (falls back to `name`). */
    title: string | null
    description: string | null
    /** ISO timestamps. Null means open-ended on that side. */
    start_at: string | null
    end_at: string | null
    submission_count: number
    created_at: string
    updated_at: string
}

/** Whitelisted email for an invite-only session. */
export interface PublicSessionInvite {
    session_id: string
    email: string
    created_at: string
}

export interface PublicSessionProject {
    session_id: string
    project_id: string
    created_at: string
}

/** Convenience shape used by the management UI: a session with the
 *  list of projects it covers (joined via public_session_projects). */
export interface PublicSessionWithProjects extends PublicSession {
    projects: { id: string; name: string }[]
}
