// Database row types for the tracker schema. Hand-written so we don't pull
// in the supabase CLI codegen toolchain just for Phase 2; regenerate with
// `supabase gen types typescript --schema tracker` once the schema settles.

// Type-only import — elided at compile, so the server-only analyser module
// (which pulls in `ws`) never reaches client bundles through this file.
import type { AnalyseEffort } from "@/lib/analyser"

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
    /** GitHub App installation whose token can act on this project's
     *  repo. Set by the install callback. Null until connected. */
    github_installation_id: number | null
    /** GitHub numeric repo id (stable across renames/transfers) — the
     *  join key for routing inbound `issues` webhooks to this project.
     *  Enforced unique-per-repo by a partial index. Null until linked. */
    github_repo_id: number | null
    /** Master toggle for two-way GitHub issue sync. Orthogonal to
     *  project_analyser.enabled — gates both inbound routing and
     *  outbound pushes. */
    github_sync_enabled: boolean
    /** Direction issues flow when sync is enabled: 'inbound' = GitHub →
     *  ucelot only, 'outbound' = ucelot → GitHub only, 'both' = full
     *  two-way (default). */
    github_sync_direction: "inbound" | "outbound" | "both"
    /** When true (and the direction allows it), deleting an issue on one
     *  side deletes/closes it on the other. Destructive → default false. */
    github_sync_deletes: boolean
    created_at: string
    updated_at: string
}

/** Allowed values for github_sync_direction. */
export const GITHUB_SYNC_DIRECTIONS = ["inbound", "outbound", "both"] as const
export type GithubSyncDirection = (typeof GITHUB_SYNC_DIRECTIONS)[number]

/** GitHub OAuth provider token captured at sign-in. One row per user;
 *  upserted by the auth callback. Used to list the user's repos in the
 *  add-project picker and to authorise the analyser's git clone for
 *  private repos. */
export interface GithubToken {
    user_id: string
    access_token: string
    refresh_token: string | null
    scopes: string | null
    provider_user_id: string | null
    provider_login: string | null
    created_at: string
    updated_at: string
}

/** A "Bobby" GitHub App installation. Created by the install callback
 *  (which sets user_id) and kept current by the `installation` webhook.
 *  Holds the installation-token cache (cached_token/token_expires_at)
 *  used by lib/github-app.ts to avoid re-minting a token per request.
 *  suspended_at / deleted_at are soft-delete lifecycle markers. */
export interface GithubInstallation {
    installation_id: number
    /** Set only by the install callback (the one flow that knows the
     *  tracker user); null for installations only seen via webhook. */
    user_id: string | null
    account_login: string | null
    account_type: string | null
    account_id: number | null
    /** Cached installation access token (short-lived) + its expiry;
     *  re-minted with a 5-min margin. Null until first mint. */
    cached_token: string | null
    token_expires_at: string | null
    suspended_at: string | null
    deleted_at: string | null
    created_at: string
    updated_at: string
}

/** Tracks Bobby's analysis of a GitHub PR so its live comment can be edited in
 *  place and the run cancelled (migration 0042). `id` doubles as the analyser
 *  task_id. One row per (project, pr_number). `result` (migration 0043) is the
 *  persisted structured review so the detail page can render it natively. */
export interface PullRequestAnalysis {
    id: string
    project_id: string
    pr_number: number
    github_comment_id: number | null
    head_sha: string | null
    status: "analysing" | "done" | "failed" | "cancelled" | null
    result: PRAnalysis | null
    created_at: string
    updated_at: string
}

/** A queryable mirror of a GitHub pull request (migration 0043). One row per
 *  (project, pr_number), upserted from webhook `pull_request` payloads + the
 *  backfill. `state` is open|closed; `merged` distinguishes a merged-closed PR
 *  from a plain-closed one. */
export interface PullRequest {
    id: string
    project_id: string
    pr_number: number
    github_node_id: string | null
    title: string
    body: string | null
    state: "open" | "closed"
    merged: boolean
    draft: boolean
    author_login: string | null
    author_avatar_url: string | null
    html_url: string | null
    head_ref: string | null
    base_ref: string | null
    head_sha: string | null
    base_sha: string | null
    additions: number | null
    deletions: number | null
    changed_files: number | null
    comments_count: number | null
    gh_created_at: string | null
    gh_updated_at: string | null
    closed_at: string | null
    merged_at: string | null
    created_at: string
    updated_at: string
}

/** A comment on a PR. `source` disambiguates the GitHub id spaces: 'issue_comment'
 *  (conversation thread), 'review' (a review's summary body), 'review_comment'
 *  (inline diff — reserved). `provenance` (migration 0044) marks whether it's a
 *  read-only GitHub mirror or a tracker-authored comment we own and push to
 *  GitHub as `author_user_id`. */
export interface PRComment {
    id: string
    project_id: string
    pr_number: number
    source: "issue_comment" | "review" | "review_comment"
    github_comment_id: number
    provenance: "github" | "tracker"
    author_user_id: string | null
    author_login: string | null
    author_avatar_url: string | null
    body: string | null
    html_url: string | null
    gh_created_at: string | null
    gh_updated_at: string | null
    created_at: string
    updated_at: string
}

/** A comment on an issue thread (migration 0044) — the issue-side mirror of
 *  PRComment (conversation comments only; no review types). */
export interface IssueComment {
    id: string
    project_id: string
    issue_number: number
    github_comment_id: number
    provenance: "github" | "tracker"
    author_user_id: string | null
    author_login: string | null
    author_avatar_url: string | null
    body: string | null
    html_url: string | null
    gh_created_at: string | null
    gh_updated_at: string | null
    created_at: string
    updated_at: string
}

/** Bobby's structured PR review — the analyser /pr/analyse result. */
export interface PRFixVerdict {
    claim: string
    verdict: "likely" | "partial" | "unlikely" | "unclear" | string
    reason: string
}
export interface PRImpactRef {
    file: string
    reason: string
}

/** A grounded, cited review item on the changed code (analyser ADR-0054). */
export interface PRFinding {
    file: string
    line?: number
    severity: "bug" | "risk" | "style" | "nit" | string
    /** Short scannable label (≤ ~8 words); detail is the one-sentence explanation. */
    title?: string
    detail: string
}
export interface PRAnalysis {
    summary: string
    impact: string
    impact_files?: PRImpactRef[]
    /** Grounded code-review findings — the core of the review (ADR-0054). */
    findings?: PRFinding[]
    /** Only present when the PR description makes an explicit claim (ADR-0054). */
    fix_claims?: PRFixVerdict[]
    /** Retired analyser-side (folded into findings); kept for old rows. */
    concerns?: string[]
    confidence?: string
    markdown?: string
    cost_usd?: number
    duration_ms?: number
    /** Session-insight id → powers the deep-dive chat (analyser ADR-0055). */
    insight_id?: string
}

/** Shape returned by GET /api/github/repos — a flattened subset of the
 *  GitHub `/user/repos` payload. `private` decides whether the picker
 *  shows a lock icon and whether the analyser kickoff needs to attach
 *  git_auth. */
export interface GithubRepoSummary {
    full_name: string       // "owner/repo"
    name: string
    private: boolean
    description: string | null
    default_branch: string
    clone_url: string       // https://github.com/owner/repo.git
    html_url: string        // https://github.com/owner/repo
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
    /** Which side last wrote this row. Null for issues never synced to
     *  GitHub. Drives provenance display and, with last_synced_hash,
     *  echo suppression. */
    sync_source: "tracker" | "github" | null
    /** syncHash(normalized title|body|state) of the last value we
     *  pushed to / ingested from GitHub. An inbound webhook whose hash
     *  equals this is our own echo → dropped. Null until first sync. */
    last_synced_hash: string | null
    /** When this issue last round-tripped with GitHub. Null until first
     *  sync. */
    github_synced_at: string | null
    /** GitHub comment id of the "analysing…" placeholder Bobby posts on the
     *  linked issue; the analyser's result callback edits this comment in
     *  place. Null until an analysis run starts. */
    github_analysis_comment_id: number | null
    /** Lifecycle of the durable, analyser-owned analysis run: 'analysing' →
     *  'done' | 'failed' | 'cancelled'. Null for issues that never triggered
     *  an analysis. */
    analysis_status: "analysing" | "done" | "failed" | "cancelled" | null
    issue_number: number
    /** When this issue was filed via the AI composer flow rather than
     *  the bare new-issue form. Surfaces an "AI" badge in lists. */
    ai_proposed: boolean
    /** When the submitter flagged this as a duplicate of another
     *  issue at create-time. The original is still persisted (we
     *  never drop user reports), but UIs treat it as a satellite. */
    duplicate_of_issue_id: string | null
    /** When the issue is scheduled on the planning timeline. Null
     *  means "unscheduled" — the issue lives in the tray below the
     *  canvas until dragged onto it. */
    starts_at: string | null
    ends_at:   string | null
    /** Vertical position on the timeline as a fraction of canvas
     *  height (0..1). Null = unscheduled. We store fractional rather
     *  than pixels so the layout survives across screen sizes. */
    lane_y:    number | null
    /** Optional per-issue colour override (#rrggbb). Null falls back
     *  to the project's status palette. */
    color:     string | null
    /** How thorough the analyser should be on THIS issue, chosen at
     *  create time (advanced settings) and overridable per-run. Null =
     *  no per-issue choice, so the analyse call omits effort and the
     *  analyser falls back to the project default → its own default. */
    analyse_effort: AnalyseEffort | null
    created_at: string
    updated_at: string
}

/** Per-project status→colour map. Falls back to the UI defaults
 *  (see lib/timeline/colors.ts) when a row is missing. */
export interface ProjectStatusColor {
    project_id: string
    status: IssueStatus
    color: string
    updated_at: string
}

/** Per-project label→icon map. Required before a label can render
 *  on the planning timeline. */
export interface ProjectLabelIcon {
    project_id: string
    label: string
    icon_name: string
    color: string | null
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
    /** The project's main routing vector. Built from name + summary
     *  + layers + features + stack + modules concatenated, embedded
     *  as one rich text by bobby-analyser. Drives 70% of
     *  find_similar_projects scoring; the layer + feature tag pools
     *  (see ProjectLayerTag / ProjectFeatureTag) supply the other
     *  30% via max-cosine refinement. */
    summary_overview_embedding: number[] | null
    /** Embedding model that produced summary_overview_embedding +
     *  the tag-pool vectors. */
    summary_model: string | null
    /** When summary_markdown + the embeddings were last refreshed. */
    summary_updated_at: string | null
    updated_at: string
}

// Per-project routing tag pools, written by bobby-analyser via the
// `replace_project_tags` RPC after each successful index. Layer is a
// short controlled vocabulary (frontend / backend / api / database /
// infra / mobile / shared); feature is hierarchical free-form
// ("auth/login", "billing/invoice"). Each row carries its own
// embedding so find_similar_projects can score "max cosine to any
// tag" rather than blending all tags into one vector.
export interface ProjectLayerTag {
    id: string
    project_id: string
    tag: string
    embedding: number[]
    created_at: string
}

export interface ProjectFeatureTag {
    id: string
    project_id: string
    tag: string
    embedding: number[]
    created_at: string
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
    /** True when the swarm ran on a locally-served model. Carried over
     *  from the analyse response. Optional here because rows cached
     *  before this field shipped won't have it — treat missing as false. */
    local?: boolean
    /** Pre-composed "fix this issue" prompt, baked at analyser time
     *  by /api/issues/[id]/suggest so the drawer can copy it to the
     *  clipboard synchronously on click (no awaited fetch — avoids
     *  Safari/Firefox losing the user-gesture token mid-await). */
    fix_prompt?: string
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
    /** When set, the session's effective project coverage is the
     *  group's current membership instead of the manual junction
     *  table. Adding a project to the group expands the session
     *  automatically; the public AI compose flow uses the group's
     *  facet embeddings to route incoming issues. Null = manual
     *  project list (current behaviour). */
    group_id: string | null
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

/** A user-defined collection of related projects. Powers the AI
 *  compose flow's "which project does this issue belong to?"
 *  routing — see find_similar_projects RPC + migration 0019. */
export interface ProjectGroup {
    id: string
    user_id: string
    name: string
    description: string | null
    created_at: string
    updated_at: string
}

/** Convenience shape for the management UI: a group plus the
 *  flattened list of projects it covers (joined via
 *  project_group_members). */
export interface ProjectGroupWithMembers extends ProjectGroup {
    members: { id: string; name: string; has_summary: boolean }[]
}
