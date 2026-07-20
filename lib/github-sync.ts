// Two-way issue-sync orchestration between tracker.issues and GitHub.
//
// Shared by both directions: the inbound webhook (app/api/webhooks/github)
// and the outbound issue handlers (app/api/issues/*). Holds the content-hash
// echo-suppression primitive, the status↔state mappers, the outbound push /
// update, and the auto-analysis comment path. See plan Phases 4–6.

import {
    createGithubIssue,
    createIssueComment,
    deleteIssueGraphQL,
    listRepoIssues,
    updateGithubIssue,
    updateIssueComment,
} from "@/lib/github-app-rest"
import {
    cancelledCommentBody,
    type CommentCtx,
    failedCommentBody,
    loadingCommentBody,
    resultCommentBody,
} from "@/lib/github-issue-comment"
import { repoFullName } from "@/lib/integrations/github"
import { composeIssueFixPrompt } from "@/lib/issues/issue-prompt"
import { createServiceClient } from "@/lib/supabase/server"
import { createSupabaseProjectAnalyserRepository, getAnalyser, isAnalyserReady, type IssueAnalysis } from "@/modules/analysis"
import type {
    GithubSyncDirection,
    IssueAnalysisData,
    IssuePriority,
    IssueStatus,
    Project,
    ProjectAnalyser,
} from "@/lib/supabase/types"

// The subset of a tracker.issues row the sync functions read. Kept structural
// (not the full Issue) so callers can pass a freshly-inserted/updated row.
type SyncIssue = {
    id: string
    title: string
    body: string | null
    status: IssueStatus
    priority?: string | null
    labels?: string[] | null
    github_issue_number: number | null
    github_node_id: string | null
}

// The subset of a tracker.projects row the sync functions read.
type SyncProject = Pick<Project, "repo_url" | "repo_full_name"> & {
    github_installation_id: number | null
    github_repo_id: number | null
    github_sync_enabled: boolean
    github_sync_direction: GithubSyncDirection
    github_sync_deletes: boolean
}

// Columns a caller must select to build a SyncProject.
export const SYNC_PROJECT_COLS =
    "id,user_id,repo_url,repo_full_name,github_installation_id,github_repo_id,github_sync_enabled,github_sync_direction,github_sync_deletes"

// Direction gates. 'inbound' = GitHub → ucelot, 'outbound' = ucelot → GitHub.
export function allowsInbound(p: { github_sync_direction: GithubSyncDirection }): boolean {
    return p.github_sync_direction === "inbound" || p.github_sync_direction === "both"
}
export function allowsOutbound(p: { github_sync_direction: GithubSyncDirection }): boolean {
    return p.github_sync_direction === "outbound" || p.github_sync_direction === "both"
}

// ─── Content hash (echo suppression) ────────────────────────────────────────

// syncHash is the loop-guard fingerprint. It MUST be computed identically on
// both sides of the sync so an inbound webhook that echoes our own outbound
// write hashes to the value we already stored in last_synced_hash and gets
// dropped. Normalization: trim, \n newlines, lowercase state.
export async function syncHash(
    title: string,
    body: string,
    state: "open" | "closed",
): Promise<string> {
    const normTitle = title.trim()
    const normBody = body.replace(/\r\n/g, "\n").trim()
    const normState = state.toLowerCase()
    const input = `${normTitle}\n${normBody}\n${normState}`
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input))
    const bytes = new Uint8Array(digest)
    let hex = ""
    for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, "0")
    return hex
}

// ─── status ↔ state mappers ─────────────────────────────────────────────────

// statusToState collapses the tracker's status vocabulary onto GitHub's binary
// open/closed. open/in_progress/blocked → open ; done/archived → closed.
export function statusToState(status: string): "open" | "closed" {
    switch (status) {
        case "done":
        case "archived":
            return "closed"
        default:
            // open / in_progress / blocked (and anything unmapped) stay open.
            return "open"
    }
}

// stateToStatus maps a GitHub state back to a tracker status. GitHub only has
// two states, so closed maps to the canonical terminal status 'done'.
export function stateToStatus(state: "open" | "closed"): string {
    return state === "closed" ? "done" : "open"
}

// ─── Outbound: create ───────────────────────────────────────────────────────

// pushIssueToGithub creates the GitHub issue for a tracker issue and writes the
// resulting number/node_id + sync bookkeeping back to the row via service-role
// BEFORE returning. Writing last_synced_hash before the resulting `opened`
// webhook lands is the outbound loop-guard. No-op unless sync is fully wired.
export async function pushIssueToGithub(issue: SyncIssue, project: SyncProject): Promise<void> {
    if (!syncReady(project) || !allowsOutbound(project)) return
    const owner_repo = repoFullName(project)
    if (!owner_repo) return
    const [owner, repo] = owner_repo.split("/")

    const created = await createGithubIssue(project.github_installation_id!, owner, repo, {
        title: issue.title,
        body: issue.body ?? "",
    })

    // GitHub opens issues in the `open` state; hash against that so the echoed
    // `opened` webhook is recognised as ours.
    const hash = await syncHash(issue.title, issue.body ?? "", "open")

    const svc = createServiceClient()
    await svc
        .from("issues")
        .update({
            github_issue_number: created.number,
            github_node_id: created.node_id,
            sync_source: "tracker",
            last_synced_hash: hash,
            github_synced_at: new Date().toISOString(),
        })
        .eq("id", issue.id)
}

// ─── Outbound: update ───────────────────────────────────────────────────────

// updateGithubIssueFromTracker mirrors a tracker edit to GitHub, sending only
// the changed subset (title/body/status→state), then refreshes the sync
// bookkeeping (writes last_synced_hash before the echoing `edited`/`closed`
// webhook lands). No-op unless the row is linked and sync is wired.
export async function updateGithubIssueFromTracker(
    issue: SyncIssue,
    project: SyncProject,
    changed: { title?: boolean; body?: boolean; status?: boolean },
): Promise<void> {
    if (!syncReady(project) || !allowsOutbound(project)) return
    if (issue.github_issue_number == null) return
    const owner_repo = repoFullName(project)
    if (!owner_repo) return
    const [owner, repo] = owner_repo.split("/")

    const state = statusToState(issue.status)
    const patch: { title?: string; body?: string; state?: "open" | "closed" } = {}
    if (changed.title) patch.title = issue.title
    if (changed.body) patch.body = issue.body ?? ""
    if (changed.status) patch.state = state
    // Nothing relevant changed → don't touch GitHub or the bookkeeping.
    if (Object.keys(patch).length === 0) return

    await updateGithubIssue(project.github_installation_id!, owner, repo, issue.github_issue_number, patch)

    const hash = await syncHash(issue.title, issue.body ?? "", state)
    const svc = createServiceClient()
    await svc
        .from("issues")
        .update({
            sync_source: "tracker",
            last_synced_hash: hash,
            github_synced_at: new Date().toISOString(),
        })
        .eq("id", issue.id)
}

// syncReady gates work on the project being fully wired for sync: toggled on +
// linked installation + linked repo id. Structural param (not full SyncProject)
// so the analysis-comment rows — which don't carry direction — can use it too;
// direction gating is separate (allowsInbound/allowsOutbound).
function syncReady(project: {
    github_sync_enabled: boolean
    github_installation_id: number | null
    github_repo_id: number | null
}): boolean {
    return (
        project.github_sync_enabled &&
        project.github_installation_id != null &&
        project.github_repo_id != null
    )
}

// ─── Outbound: delete ───────────────────────────────────────────────────────

// deleteGithubIssueFromTracker deletes (or closes) the linked GitHub issue when
// a tracker issue is deleted and delete-propagation is on. GitHub's REST API
// can't delete issues, so we try the GraphQL deleteIssue mutation (needs the
// node id); if the org/app can't hard-delete, we fall back to closing it. No-op
// unless sync is wired, direction allows outbound, and deletes are enabled.
export async function deleteGithubIssueFromTracker(issue: SyncIssue, project: SyncProject): Promise<void> {
    if (!syncReady(project) || !allowsOutbound(project) || !project.github_sync_deletes) return
    const installationId = project.github_installation_id!

    // Prefer a true delete via GraphQL using the stored node id.
    if (issue.github_node_id) {
        const deleted = await deleteIssueGraphQL(installationId, issue.github_node_id).catch(() => false)
        if (deleted) return
    }
    // Fallback: close it (REST) — hard-delete isn't always permitted.
    if (issue.github_issue_number != null) {
        const full = repoFullName(project)
        if (!full) return
        const [owner, repo] = full.split("/")
        await updateGithubIssue(installationId, owner, repo, issue.github_issue_number, {
            state: "closed",
        }).catch(() => {})
    }
}

// ─── Auto-analysis: durable, cancellable, live GitHub comment ───────────────
//
// On issue open we post a placeholder comment ("analysing…"), store its id, and
// kick off a DETACHED analyser run (POST /issues/analyse/run) with a callback
// pointing back at this app. The analyser owns the task lifecycle: it runs in
// its own process (so the user can close the page), and on a terminal state
// (done / cancelled / failed) it POSTs the result to /api/internal/analysis-
// result → applyAnalysisResult edits the placeholder comment in place. Closing
// the issue cancels the run. See the analyser's issue_async.go + ADR-0051.

// Structural subset the analysis flow reads from tracker.issues / .projects.
type AnalysisIssueRow = {
    id: string
    project_id: string
    issue_number: number
    title: string
    body: string | null
    status: IssueStatus
    priority: string | null
    labels: string[] | null
    github_issue_number: number | null
    github_analysis_comment_id: number | null
    analysis_status: string | null
}
type AnalysisProjectRow = Pick<Project, "name" | "repo_url" | "repo_full_name" | "description"> & {
    github_installation_id: number | null
    github_repo_id: number | null
    github_sync_enabled: boolean
}

const ANALYSIS_ISSUE_COLS =
    "id,project_id,issue_number,title,body,status,priority,labels,github_issue_number,github_analysis_comment_id,analysis_status"
const ANALYSIS_PROJECT_COLS =
    "name,repo_url,repo_full_name,description,github_installation_id,github_repo_id,github_sync_enabled"

// ensureAnalysis kicks off the SINGLE analysis run for an issue and is the one
// entry point for both surfaces: the tracker's suggestion box (via the
// issue_suggestions row its callback writes → realtime) and the GitHub comment
// (posted here, edited by the callback). Idempotent + one-shot — it never
// starts a second run:
//   - a run already in flight (analysis_status='analysing') → "in_flight"
//   - a result already cached (issue_suggestions row exists)  → "done"
// Otherwise it marks the issue in-flight, posts the "analysing…" placeholder
// comment WHEN the issue is GitHub-linked and sync is on (skipped for web-only
// projects), and launches the detached analyser run. Whoever triggers first
// (webhook, issue create, or the web box opening the issue) wins; the rest
// no-op. `origin` is this app's public origin (the analyser calls it back).
export async function ensureAnalysis(
    issueId: string,
    origin: string,
): Promise<"started" | "in_flight" | "done" | "not_ready" | "no_issue"> {
    const svc = createServiceClient()

    const { data: issue } = await svc
        .from("issues")
        .select(ANALYSIS_ISSUE_COLS)
        .eq("id", issueId)
        .maybeSingle<AnalysisIssueRow>()
    if (!issue) return "no_issue"

    // Idempotent / one-shot: don't start a second run.
    if (issue.analysis_status === "analysing") return "in_flight"
    const { count } = await svc
        .from("issue_suggestions")
        .select("id", { count: "exact", head: true })
        .eq("issue_id", issueId)
    if ((count ?? 0) > 0) return "done"

    const analyser = await createSupabaseProjectAnalyserRepository(svc).findByProjectId(issue.project_id)
    // No run unless the graph is indexed.
    if (!isAnalyserReady(analyser)) return "not_ready"

    const update: Record<string, unknown> = { analysis_status: "analysing" }

    // Post the "analysing…" placeholder comment only when the issue is
    // GitHub-linked and sync is on. For web-only projects the analysis still
    // runs and caches — there's just no GitHub comment.
    const { data: project } = await svc
        .from("projects")
        .select(ANALYSIS_PROJECT_COLS)
        .eq("id", issue.project_id)
        .maybeSingle<AnalysisProjectRow>()
    if (project && syncReady(project) && issue.github_issue_number != null) {
        const full = repoFullName(project)
        if (full) {
            const [owner, repo] = full.split("/")
            try {
                const { id: commentId } = await createIssueComment(
                    project.github_installation_id!,
                    owner,
                    repo,
                    issue.github_issue_number,
                    loadingCommentBody({ origin, projectId: issue.project_id, issueId: issue.id }),
                )
                update.github_analysis_comment_id = commentId
            } catch {
                // Comment is best-effort; the analysis still runs + caches.
            }
        }
    }

    await svc.from("issues").update(update).eq("id", issueId)

    // Kick the single detached run; its callback caches to issue_suggestions
    // (the web box picks it up via realtime) and edits the GitHub comment.
    await getAnalyser().startIssueAnalysis(
        {
            repoId: analyser.graph_id,
            title: issue.title,
            body: issue.body || "",
            labels: issue.labels || [],
            priority: issue.priority || undefined,
        },
        issueId,
        { url: `${origin}/api/internal/analysis-result`, token: process.env.BOBBY_ANALYSER_TOKEN },
    )
    return "started"
}

// applyAnalysisResult is invoked by /api/internal/analysis-result when the
// analyser reports a terminal state. It edits the placeholder comment in place
// (result / cancelled / failed), records analysis_status, and (on success)
// caches the suggestion so the tracker UI mirrors it.
export async function applyAnalysisResult(
    taskId: string,
    status: "done" | "failed" | "cancelled",
    result: IssueAnalysis | null,
    origin: string,
): Promise<void> {
    const svc = createServiceClient()

    const { data: issue } = await svc
        .from("issues")
        .select(ANALYSIS_ISSUE_COLS)
        .eq("id", taskId)
        .maybeSingle<AnalysisIssueRow>()
    if (!issue) return

    const { data: project } = await svc
        .from("projects")
        .select(ANALYSIS_PROJECT_COLS)
        .eq("id", issue.project_id)
        .maybeSingle<AnalysisProjectRow>()

    // Edit the placeholder in place (when we still have its id + a linked repo).
    if (project && syncReady(project) && issue.github_analysis_comment_id != null) {
        const full = repoFullName(project)
        if (full) {
            const [owner, repo] = full.split("/")
            const ctx: CommentCtx = { origin, projectId: issue.project_id, issueId: issue.id }
            const body =
                status === "done" && result
                    ? resultCommentBody(result, project, ctx)
                    : status === "cancelled"
                      ? cancelledCommentBody(ctx)
                      : failedCommentBody(ctx)
            try {
                await updateIssueComment(project.github_installation_id!, owner, repo, issue.github_analysis_comment_id, body)
            } catch {
                // The comment may have been deleted on GitHub — don't fail the callback.
            }
        }
    }

    await svc.from("issues").update({ analysis_status: status }).eq("id", taskId)

    // Cache the successful analysis so the tracker UI mirrors the comment.
    if (status === "done" && result && project) {
        try {
            const { data: analyser } = await svc
                .from("project_analyser")
                .select("graph_id")
                .eq("project_id", issue.project_id)
                .maybeSingle<Pick<ProjectAnalyser, "graph_id">>()
            const graphId = analyser?.graph_id ?? null
            const dataWithPrompt: IssueAnalysisData = {
                ...result,
                fix_prompt: composeIssueFixPrompt({
                    project,
                    issue: {
                        issue_number: issue.issue_number,
                        title: issue.title,
                        body: issue.body ?? "",
                        status: issue.status,
                        priority: (issue.priority ?? "medium") as IssuePriority,
                        labels: issue.labels ?? [],
                    },
                    suggestion: {
                        id: "",
                        issue_id: issue.id,
                        data: result,
                        markdown: result.markdown ?? result.summary ?? "",
                        code_cites: (result.suggestions ?? []).map((s) => ({ file: s.file, line: s.line })),
                        graph_cites: result.graph_cites ?? [],
                        confidence: result.confidence ?? null,
                        cost_usd: result.cost_usd ?? 0,
                        duration_ms: result.duration_ms ?? 0,
                        graph_id: graphId,
                        created_at: new Date().toISOString(),
                    },
                }),
            }
            await svc.from("issue_suggestions").insert({
                issue_id: issue.id,
                data: dataWithPrompt,
                markdown: result.markdown ?? result.summary ?? "",
                code_cites: (result.suggestions ?? []).map((s) => ({ file: s.file, line: s.line })),
                graph_cites: result.graph_cites ?? [],
                confidence: result.confidence ?? null,
                cost_usd: result.cost_usd ?? 0,
                duration_ms: result.duration_ms ?? 0,
                graph_id: graphId,
            })
        } catch {
            // Cache is best-effort; the bot comment is the source of truth.
        }
    }
}

// cancelAnalysis asks the analyser to stop an in-flight run (issue closed). The
// analyser then reports status=cancelled via the callback, which edits the
// comment. Best-effort — a cancel for an already-finished task is a no-op.
export async function cancelAnalysis(issueId: string): Promise<void> {
    await getAnalyser().cancelIssueAnalysis(issueId)
}

// ─── Hard sync (backfill) ───────────────────────────────────────────────────

// importExistingIssues pulls all existing GitHub issues into the tracker (the
// "hard sync" action). Idempotent — skips issues already linked by number.
// Deliberately does NOT auto-analyse each one (a repo can have hundreds; that
// would be a cost blow-up) — new activity still triggers analysis as usual.
// No-op unless sync is wired and the direction allows inbound.
export async function importExistingIssues(
    projectId: string,
): Promise<{ imported: number; total: number; skipped: number }> {
    const svc = createServiceClient()

    const { data: project } = await svc
        .from("projects")
        .select(SYNC_PROJECT_COLS)
        .eq("id", projectId)
        .maybeSingle<SyncProject & { user_id: string }>()
    if (!project || !syncReady(project) || !allowsInbound(project)) {
        return { imported: 0, total: 0, skipped: 0 }
    }
    const full = repoFullName(project)
    if (!full) return { imported: 0, total: 0, skipped: 0 }
    const [owner, repo] = full.split("/")

    const gh = await listRepoIssues(project.github_installation_id!, owner, repo, { state: "all" })

    // Numbers already linked to this project → skip (idempotent re-runs).
    const { data: existing } = await svc
        .from("issues")
        .select("github_issue_number")
        .eq("project_id", projectId)
        .not("github_issue_number", "is", null)
    const seen = new Set(
        (existing ?? []).map((r: { github_issue_number: number | null }) => r.github_issue_number),
    )

    let imported = 0
    let skipped = 0
    for (const it of gh) {
        if (seen.has(it.number)) {
            skipped++
            continue
        }
        const closed = it.state === "closed"
        const { error } = await svc.from("issues").insert({
            project_id: projectId,
            user_id: project.user_id,
            title: it.title,
            body: it.body ?? "",
            status: stateToStatus(closed ? "closed" : "open"),
            github_issue_number: it.number,
            github_node_id: it.node_id,
            sync_source: "github",
            last_synced_hash: await syncHash(it.title, it.body ?? "", closed ? "closed" : "open"),
            github_synced_at: new Date().toISOString(),
        })
        if (!error) imported++
    }
    return { imported, total: gh.length, skipped }
}
