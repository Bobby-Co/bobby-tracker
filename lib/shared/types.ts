// Database row types for the tracker schema. Hand-written so we don't pull
// in the supabase CLI codegen toolchain just for Phase 2; regenerate with
// `supabase gen types typescript --schema tracker` once the schema settles.

import type { Report } from "./report/registry"

export type IssueStatus = "open" | "in_progress" | "blocked" | "done" | "archived" | "duplicated"
export type IssuePriority = "low" | "medium" | "high" | "urgent"
export type AnalyserStatus = "disabled" | "pending" | "indexing" | "ready" | "failed"

export interface Project {
    id: string
    /** The team that OWNS this project (migration 0052). Access is scoped to
     *  members of this team; the finer "which member sees it" gate lives in
     *  modules/access (AccessService), not in RLS. */
    team_id: string
    /** The creator. Since 0052 this is provenance only ("created_by") — ownership
     *  is team_id. Left named user_id (and typed non-null) to avoid churning ~30
     *  call sites; the DB FK is ON DELETE SET NULL, so it can be null only after
     *  the creator's account is deleted — an edge the app doesn't branch on. */
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
    /** VCS provider this project is linked to (migration 0055). Defaults to
     *  'github'; 'gitlab' projects link via gitlab_project_id + gitlab_host. */
    provider: "github" | "gitlab"
    /** GitLab numeric project id (unique only within its instance). */
    gitlab_project_id: number | null
    /** GitLab instance host (e.g. 'gitlab.com' or 'git.acme.com'); with
     *  gitlab_project_id it identifies the remote and routes inbound webhooks. */
    gitlab_host: string | null
    /** When true (default), a push to the repo's default branch auto-triggers
     *  an incremental graph update (ADR-0058). Independent of github_sync_enabled;
     *  the webhook no-ops unless the App is installed and a graph exists. */
    auto_index_on_push: boolean
    /** How eagerly to flag likely duplicates (0072). A NAME — the cosine
     *  threshold lives in modules/issues DuplicateSensitivity. Note the
     *  inversion: 'low' is a high threshold and flags less. */
    duplicate_sensitivity: string
    /** User-chosen icon: a canonical Iconly slug (same value space as
     *  ProjectLabelIcon.icon_name), set from the settings page. Null → the app
     *  falls back to a stable hash-derived glyph on the tile and header. */
    icon_name: string | null
    created_at: string
    updated_at: string
}

/** Per-project read model backing the projects-grid tile footer (0047).
 *  Maintained entirely by triggers on issues/pull_requests — never written
 *  from the app — so reading the grid is one indexed row per project. */
export interface ProjectInsight {
    project_id: string
    user_id: string
    /** status in (open, in_progress, blocked) — the app's !isClosed() set. */
    open_total: number
    /** status = 'done' only. 'archived' and 'duplicated' are closed but not
     *  done, so they sit in neither counter and never inflate done/total. */
    done_total: number
    urgent_open: number
    /** Last time urgent_open rose — issue created urgent, or escalated to it. */
    last_urgent_at: string | null
    /** Creation time of the newest issue (0048). Distinct from last_activity_at,
     *  which tracks the newest *update* — an edit to an old issue must not read
     *  as "2 / 7, 3m ago". Recomputed on delete, so it never points at a
     *  removed issue. */
    last_issue_created_at: string | null
    /** Open timestamps of the 10 most recent non-draft PRs, newest first.
     *  Stored raw, not as a window count: nothing fires when a PR stops being
     *  recent, so the window is applied client-side at render (ProjectInsight.status). */
    recent_pr_opens: string[]
    /** Newest issue/PR activity — what the tile footer should show.
     *  projects.updated_at is the project row's touch time and does not move
     *  when an issue does. */
    last_activity_at: string | null
    updated_at: string
}

/** A project row with its insight embedded — the shape of GET /api/projects?stats=1. */
export type ProjectWithInsight = Project & { insight: ProjectInsight | null }

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
/** The reviewer configuration a run actually used, as it crossed the wire
 *  (migration 0079). Structurally the ReviewPolicyWire that
 *  modules/analysis/domain/ReviewProfile.ts compiles — restated here with plain
 *  `string` dials rather than imported, because lib/shared deliberately depends
 *  on nothing outside lib/shared. The literal unions there are assignable to
 *  this, so the service still hands over a compiled policy without a cast, and a
 *  renderer reading a dial value this build doesn't know shows it verbatim
 *  instead of failing to compile. */
export interface ReviewRunPolicy {
    strictness: string
    evidence: string
    blocking: string
    positivity: string
    verbosity: string
    voice: string
    depth: string
    lenses: string[]
    instructions?: string
    path_rules?: { glob: string; text: string }[]
}

/** Which reviewer produced a review (migration 0079). Snapshotted onto the run
 *  at dispatch rather than read back through projects.review_profile_id, which
 *  says what the NEXT review will use — re-labelling old reviews every time the
 *  assignment moves is worse than not labelling them at all.
 *
 *  A discriminated union because "the built-in default ran" and "we don't know
 *  what ran" are genuinely different answers, and only the second one is a gap.
 *  `null` on the row is that gap: a run from before attribution existed. */
export type ReviewRunProfile =
    | { kind: "default" }
    | { kind: "profile"; id: string | null; name: string; preset: string | null; policy: ReviewRunPolicy }

export interface PullRequestAnalysis {
    id: string
    project_id: string
    pr_number: number
    github_comment_id: number | null
    head_sha: string | null
    status: "analysing" | "done" | "failed" | "cancelled" | null
    result: PrAnalysis | null
    /** The profile this run used, for queries ("what did this profile review?").
     *  Null for a default-reviewer run. See ReviewRunProfile for why this is a
     *  plain uuid with no foreign key behind it. */
    review_profile_id: string | null
    /** What ran, in full. Null only for runs that predate migration 0079. */
    review_profile: ReviewRunProfile | null
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
export interface PrComment {
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
 *  PrComment (conversation comments only; no review types). */
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
export interface PrFixVerdict {
    claim: string
    verdict: "likely" | "partial" | "unlikely" | "unclear" | string
    reason: string
}
export interface PrImpactRef {
    file: string
    reason: string
}

/** A cited evidence anchor backing a finding (analyser ADR-0057). Points at a
 *  concrete file (optionally a line), with `kind` describing what was inspected
 *  ("precedent" | "caller" | "test" | "git" | "failure" | …) and `note` a short
 *  human gloss. All fields but `file` are optional — older/looser anchors omit them. */
export interface PrEvidence {
    file: string
    line?: number
    kind?: string
    note?: string
}

/** A grounded, cited review item on the changed code (analyser ADR-0054). */
export interface PrFinding {
    file: string
    line?: number
    /** STATE chosen by impact (ADR-0056): "critical" | "review" | "good". Older
     *  rows may carry the legacy bug|risk|style|nit — normalised by findingState. */
    severity: "critical" | "review" | "good" | string
    /** Topic of the finding (analyser ADR-0057): "bug" | "convention" |
     *  "blast_radius" | "test_gap" | "drift" | "failure" | "history" | "good".
     *  Distinct from `severity` (the traffic-light state). Optional — legacy rows
     *  produced before ADR-0057 don't carry it. */
    category?: string
    /** Short topic (≤ ~8 words), may lead with a category tag ("Convention:"). */
    title?: string
    detail: string
    /** Cited KB anchors the reviewer inspected to ground this finding
     *  (analyser ADR-0057). Empty/absent on legacy rows. */
    evidence?: PrEvidence[]
    /** What the reviewer verified for this finding (analyser ADR-0057) —
     *  e.g. "callers of Foo still compile". Absent on legacy rows. */
    checked?: string[]
    /** The finding's diff hunk (the actual changed code) for a syntax-highlighted
     *  snippet in the UI; `lang` is the fenced-block language (usually "diff"). */
    snippet?: string
    lang?: string
}

/** Per-dimension calibrated confidence (analyser ADR-0057). `level` is the
 *  coarse bucket; `basis` is the one-line justification for that level. */
export interface PrConfidenceDimension {
    level: "high" | "medium" | "low" | string
    basis: string
}

/** The three review dimensions the analyser calibrates confidence over
 *  (analyser ADR-0057). Supersedes the flat `confidence` rollup when present. */
export interface PrConfidences {
    correctness: PrConfidenceDimension
    load_perf: PrConfidenceDimension
    security: PrConfidenceDimension
}

/** The KB-verification tally the reviewer accrued (analyser ADR-0057) — the
 *  concrete diligence counts surfaced as a "checked N callers · …" footer.
 *  `dropped` is findings that couldn't be grounded and were cut;
 *  `removed_symbols` is symbols the diff deleted that the reviewer traced. */
export interface PrChecks {
    precedents: number
    callers: number
    tests: number
    git_reads: number
    failure_probes: number
    dropped?: number
    removed_symbols?: number
}
export interface PrAnalysis {
    /** The PR title, echoed by the analyser (ADR-0057) → the comment header
     *  "PR Review (title)". Absent on older results; the comment falls back to #N. */
    title?: string
    summary: string
    impact: string
    impact_files?: PrImpactRef[]
    /** Grounded code-review findings — the core of the review (ADR-0054). */
    findings?: PrFinding[]
    /** Only present when the PR description makes an explicit claim (ADR-0054). */
    fix_claims?: PrFixVerdict[]
    /** Retired analyser-side (folded into findings); kept for old rows. */
    concerns?: string[]
    /** Flat rollup confidence (analyser ADR-0054). Superseded by `confidences`
     *  when the KB reviewer calibrates per-dimension (ADR-0057); kept as the
     *  back-compat fallback for rows without the finer breakdown. */
    confidence?: string
    /** Per-dimension calibrated confidence (analyser ADR-0057). Nullable — legacy
     *  results carry only the flat `confidence`. */
    confidences?: PrConfidences | null
    /** KB-verification tally (analyser ADR-0057) — powers the diligence footer.
     *  Nullable — absent on legacy results. */
    checks?: PrChecks | null
    /** Merge recommendation + one-line reason (analyser ADR-0056). */
    verdict?: "approve" | "request_changes" | "comment" | string
    verdict_reason?: string
    /** Deterministic merge-readiness headline 0..score_max (analyser ADR-0057),
     *  rendered as "X/N" + a segmented bar. Absent on legacy rows. */
    score?: number
    score_max?: number
    /** Verify-before-merge items (analyser ADR-0056). */
    checklist?: string[]
    markdown?: string
    cost_usd?: number
    duration_ms?: number
    /** Session-insight id → powers the deep-dive chat (analyser ADR-0055). */
    insight_id?: string
    /** The analyser build that produced this review — a short git SHA, with
     *  `-dirty` for an unclean tree.
     *
     *  Rides the result JSON, so it needed no migration. Absent on every review
     *  written before the analyser started stamping it, and that absence is
     *  read as "unknown" rather than filled in: findings, layout, lenses and
     *  gating all move between builds, so a guessed build is worse than none. */
    analyser_build?: string
    /** The review's LAYOUT — which blocks render, in what order (analyser
     *  ADR-0066). It ACCOMPANIES the fields above rather than replacing them:
     *  the blocks reference this data, because the analyser's gate rewrites
     *  `findings` after the review pass and a layout carrying its own copy would
     *  drift from it. Absent on every row written before blocks existed, which
     *  both renderers read as "use the classic layout". */
    report?: Report | null
}

/** Shape returned by GET /api/github/repos — a flattened subset of the
 *  GitHub `/user/repos` payload. `private` decides whether the picker
 *  shows a lock icon and whether the analyser kickoff needs to attach
 *  git_auth. */
export interface GithubRepoSummary {
    /** GitHub's numeric repo id — stable across renames and transfers, and the
     *  join key inbound webhooks arrive with. Captured at create so a repo the
     *  team already tracks is rejected up front rather than at App-install. */
    id: number
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
    analyse_effort: "fast" | "medium" | "high" | "veryhigh" | null
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
    /** Owning team (migration 0052). */
    team_id: string
    /** Creator ("created_by"); ownership is team_id. See Project.user_id. */
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
    /** Owning team (migration 0052). */
    team_id: string
    /** Creator ("created_by"); ownership is team_id. See Project.user_id. */
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

/** What a notification is about. The popover maps this to an icon +
 *  tone — the DB stores the fact, not the styling. */
export type NotificationKind =
    | "kb_ready"          // first successful index of a project
    | "kb_updated"        // every index after that
    | "kb_failed"         // an index run ended in 'failed' (migration 0078)
    | "pr_analysis_ready" // Bobby's PR review finished
    | "pr_opened"         // a new PR landed on a synced repo

/** A row in the topbar bell's feed (migration 0049). Written only by
 *  DB triggers — the KB event has no server-side code path at all, since
 *  the analyser PATCHes project_analyser directly. Clients may mark read
 *  and delete; the UPDATE grant is column-scoped to read_at. */
export interface Notification {
    id: string
    user_id: string
    project_id: string | null
    kind: NotificationKind
    /** Rendered verbatim. A point-in-time snapshot, so a project renamed
     *  later keeps the name it had when the event happened. */
    title: string
    /** Secondary line — typically "Project · PR #12". */
    meta: string | null
    /** In-app path to open on click. */
    href: string | null
    /** Null = unread. */
    read_at: string | null
    created_at: string
}

// ─── Collaboration: teams, members, people-groups (migration 0052) ──────────

/** A member's standing in a team. Drives the app-layer authz decisions in
 *  modules/access (owner/admin see all team projects; member sees only projects
 *  granted to a group they're in). RLS itself is coarse (team membership only) —
 *  roles are NOT a DB gate except on the escalation-sensitive tables. */
export type TeamRole = "owner" | "admin" | "member"
export const TEAM_ROLES: TeamRole[] = ["owner", "admin", "member"]

/** A team owns resources (projects, public sessions, project_groups). Every user
 *  has exactly one personal team (is_personal) created lazily on first authed
 *  request via the ensure_personal_team RPC. */
export interface Team {
    id: string
    name: string
    is_personal: boolean
    /** Creator; null after the creator's account is deleted (FK SET NULL). */
    created_by: string | null
    /** User-facing geography this team was placed in, e.g. 'south-east-asia'
     *  (0064). Chosen once at team creation; every project the team owns is
     *  served from here. */
    region: string
    /** The deployment unit holding this team's regional content and serving its
     *  analyser, e.g. 'bangkok-0' (0064). Assigned by the registry, never chosen
     *  by the user and never shown to one.
     *
     *  Both are plain strings rather than unions: the id space is open by design
     *  so a new cell is a config change, and the DB validates format only. Parse
     *  through modules/regions (parseCellId / parseRegionId) before use — the
     *  branded types are what stop a region reaching a cell-shaped parameter. */
    cell: string
    created_at: string
    updated_at: string
}

/** A team plus the caller's own role in it — the shape of GET /api/teams. */
export interface TeamWithRole extends Team {
    role: TeamRole
}

/** Row in tracker.team_members. */
export interface TeamMember {
    team_id: string
    user_id: string
    role: TeamRole
    created_at: string
    updated_at: string
}

/** A member row enriched with the resolved auth profile (email/name/avatar),
 *  looked up server-side via the service-role client since auth.users is outside
 *  the tracker schema. Backs the Members management tab. */
export interface TeamMemberView {
    user_id: string
    role: TeamRole
    email: string | null
    name: string | null
    avatar_url: string | null
    created_at: string
}

/** A people-group inside a team (tracker.access_groups). NOT the same as
 *  ProjectGroup ("Collections", a group of projects for AI routing). Admins
 *  assign which projects each group's members may access. */
export interface AccessGroup {
    id: string
    team_id: string
    name: string
    description: string | null
    created_by: string | null
    created_at: string
    updated_at: string
}

/** Minimal profile for a group member (their team role isn't shown here). */
export interface GroupMemberProfile {
    user_id: string
    email: string | null
    name: string | null
    avatar_url: string | null
}

/** An access group with its resolved members + granted project ids — backs the
 *  Groups management tab. */
export interface AccessGroupWithDetail extends AccessGroup {
    members: GroupMemberProfile[]
    project_ids: string[]
}

/** Person↔group membership (tracker.access_group_members). */
export interface AccessGroupMember {
    group_id: string
    team_id: string
    user_id: string
    created_at: string
}

/** Group↔project access grant (tracker.access_group_projects). */
export interface AccessGroupProject {
    group_id: string
    team_id: string
    project_id: string
    created_at: string
}

/** A pending email invitation to a team (tracker.team_invites). The token is the
 *  accept-link secret; only surfaced to admins and to the invitee's accept flow. */
export interface TeamInvite {
    id: string
    team_id: string
    email: string
    role: TeamRole
    token: string
    invited_by: string | null
    created_at: string
    accepted_at: string | null
    expires_at: string | null
}
