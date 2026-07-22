import { after } from "next/server"
import { createSupabaseProjectAnalyserRepository, getAnalyser, createIssueAnalysisService } from "@/modules/analysis"
import { tryOrNull } from "@/lib/shared/kernel"
import { getWebhookVerifier, SyncHash } from "@/modules/vcs"
import { createPullRequestAnalysisService } from "@/modules/analysis"
import { createIssueEmbedder, Issue as IssueAggregate, createServiceIssueSyncStore } from "@/modules/issues"
import { Project as ProjectAggregate } from "@/modules/projects"
import { createServicePullRequestStore } from "@/modules/vcs"
import { createServiceClient } from "@/lib/server/supabase"
import type { Issue, Project } from "@/lib/shared/types"

// INBOUND WEBHOOK — public (NO requireUser). GitHub signs each delivery with
// the app webhook secret; we prove authenticity by HMAC over the RAW body
// (verifyWebhookSignature) before parsing anything. Writes go through the
// service-role client so RLS doesn't block webhook-driven upserts, exactly
// like app/api/public-issues (external reporter, no Supabase session).
//
// The whole handler is bounded work — one signature check plus a couple of
// service-role writes — so it returns 202 well inside GitHub's ~10s window.
// Analysis is kicked off detached (startAnalysis → analyser /issues/analyse/run,
// which owns the durable, cancellable task and calls us back).
export const dynamic = "force-dynamic"

// 202 is the canonical webhook ack: accepted, nothing more for GitHub to do.
function ack() {
    return new Response(null, { status: 202 })
}

export async function POST(request: Request) {
    // (1) Read the RAW body first — a single stream read. Any .json() before
    // this would consume the stream and break signature verification.
    const raw = await request.text()

    // (2) Verify the provider signature over the raw body via the WebhookVerifier
    // port (GitHub: HMAC-SHA256 against x-hub-signature-256).
    const signature = request.headers.get("x-hub-signature-256")
    if (!(await getWebhookVerifier().verify(raw, signature))) {
        return new Response("bad signature", { status: 401 })
    }

    const deliveryId = request.headers.get("x-github-delivery") ?? ""
    const event = request.headers.get("x-github-event") ?? ""

    const svc = createServiceClient()

    // (3) Delivery dedupe. GitHub retries/redelivers; the PK on delivery_id
    // makes a re-seen delivery a unique violation → stop (already processed).
    if (deliveryId) {
        const { error: dedupeErr } = await svc
            .from("github_webhook_deliveries")
            .insert({ delivery_id: deliveryId, event })
        if (dedupeErr) {
            if (dedupeErr.code === "23505") return ack()
            // Any other insert failure: don't process without an idempotency
            // record, or a retry would double-apply. Let GitHub retry.
            return new Response("delivery record failed", { status: 500 })
        }
    }

    // (4) Parse now that the signature is trusted, and branch on the event.
    let payload: Record<string, unknown>
    try {
        payload = JSON.parse(raw)
    } catch {
        return ack()
    }

    if (event === "installation" || event === "installation_repositories") {
        await handleInstallation(svc, payload)
        return ack()
    }

    if (event === "issues") {
        const action = String((payload as { action?: unknown }).action ?? "")
        if (
            action === "opened" ||
            action === "edited" ||
            action === "closed" ||
            action === "reopened" ||
            action === "deleted"
        ) {
            return handleIssue(svc, payload, action, new URL(request.url).origin)
        }
    }

    if (event === "pull_request") {
        const action = String((payload as { action?: unknown }).action ?? "")
        if (
            action === "opened" ||
            action === "reopened" ||
            action === "synchronize" ||
            action === "closed"
        ) {
            return handlePullRequest(svc, payload, action, new URL(request.url).origin)
        }
    }

    // PR conversation comments + review summaries → tracker.pr_comments.
    if (event === "issue_comment" || event === "pull_request_review") {
        return handlePrComment(svc, event, payload)
    }

    // A push to the default branch triggers an incremental graph update.
    if (event === "push") {
        return handlePush(svc, payload)
    }

    // Unhandled event/action — acknowledge and move on.
    return ack()
}

type Svc = ReturnType<typeof createServiceClient>

// ─── installation lifecycle ─────────────────────────────────────────────────

// Upsert the installation's account fields and reflect its lifecycle
// (suspend/unsuspend, delete). We deliberately do NOT set user_id here — only
// the install callback (GET /api/github/app/callback) knows which tracker user
// installed the app; a webhook-first upsert leaves user_id null.
async function handleInstallation(svc: Svc, payload: Record<string, unknown>) {
    const installation = payload.installation as
        | { id?: number; account?: { login?: string; type?: string; id?: number }; suspended_at?: string | null }
        | undefined
    const installationId = installation?.id
    if (!installationId) return

    const action = String(payload.action ?? "")
    const nowIso = new Date().toISOString()

    const row: Record<string, unknown> = {
        installation_id: installationId,
        account_login: installation?.account?.login ?? null,
        account_type: installation?.account?.type ?? null,
        account_id: installation?.account?.id ?? null,
        updated_at: nowIso,
    }

    // Lifecycle transitions. `suspend`/`unsuspend`/`deleted` arrive on the
    // `installation` event; other actions (created, new_permissions_accepted,
    // installation_repositories.*) just refresh the account fields.
    if (action === "deleted") {
        row.deleted_at = nowIso
    } else if (action === "suspend") {
        row.suspended_at = installation?.suspended_at ?? nowIso
    } else if (action === "unsuspend") {
        row.suspended_at = null
    } else {
        // A fresh (re)install clears any prior soft-delete/suspension.
        if (action === "created") {
            row.deleted_at = null
            row.suspended_at = null
        }
    }

    await svc.from("github_installations").upsert(row, { onConflict: "installation_id" })
}

// ─── issues core path ───────────────────────────────────────────────────────

async function handleIssue(
    svc: Svc,
    payload: Record<string, unknown>,
    action: string,
    origin: string,
): Promise<Response> {
    const repository = payload.repository as { id?: number } | undefined
    const gh = payload.issue as
        | {
              number?: number
              node_id?: string
              title?: string
              body?: string | null
              state?: string
              updated_at?: string
          }
        | undefined
    const repoId = repository?.id
    const number = gh?.number
    if (!repoId || !number) return ack()

    // (5) Map repo → project via the stable numeric repo id, gated on sync
    // being enabled. No enabled project owns this repo → nothing to do.
    const { data: project } = await svc
        .from("projects")
        .select("id,user_id,github_installation_id,github_repo_id,github_sync_enabled,github_sync_direction,github_sync_deletes")
        .eq("github_repo_id", repoId)
        .eq("github_sync_enabled", true)
        .maybeSingle<
            Pick<
                Project,
                | "id"
                | "user_id"
                | "github_installation_id"
                | "github_repo_id"
                | "github_sync_enabled"
                | "github_sync_direction"
                | "github_sync_deletes"
            >
        >()
    if (!project) return ack()

    // Direction gate: GitHub-side changes only apply when the project pulls from
    // GitHub. An outbound-only project ignores inbound issue events.
    if (!ProjectAggregate.of(project).allowsInbound()) return ack()

    // Deletion: drop the linked tracker issue only when delete-propagation is
    // on; otherwise leave it (an orphaned row is safer than a surprise delete).
    if (action === "deleted") {
        if (project.github_sync_deletes) {
            await svc.from("issues").delete().eq("project_id", project.id).eq("github_issue_number", number)
        }
        return ack()
    }

    const title = gh?.title ?? ""
    const body = gh?.body ?? ""
    const state: "open" | "closed" = gh?.state === "closed" ? "closed" : "open"

    // Find the already-linked tracker row (if any) for this repo+issue number.
    const { data: existing } = await svc
        .from("issues")
        .select("id,updated_at,last_synced_hash")
        .eq("project_id", project.id)
        .eq("github_issue_number", number)
        .maybeSingle<Pick<Issue, "id" | "updated_at" | "last_synced_hash">>()

    // (6) Echo guard. If the incoming content hashes to what we last synced
    // for this row, this webhook is our own outbound write bouncing back.
    const hash = await new SyncHash().compute(title, body, state)
    if (existing && existing.last_synced_hash === hash) return ack()

    const nowIso = new Date().toISOString()
    const syncFields = {
        title,
        body,
        status: IssueAggregate.statusFromGithubState(state),
        github_issue_number: number,
        github_node_id: gh?.node_id ?? null,
        sync_source: "github" as const,
        last_synced_hash: hash,
        github_synced_at: nowIso,
    }

    if (existing) {
        // (7, conflict rule) Last-writer-wins by updated_at: if the tracker
        // row was edited more recently than GitHub's payload AND the content
        // genuinely diverges (hash already differs, checked above), the local
        // edit wins — skip the inbound overwrite. The outbound push will
        // reconcile GitHub from the tracker side.
        const ghUpdatedAt = gh?.updated_at ? Date.parse(gh.updated_at) : NaN
        const rowUpdatedAt = existing.updated_at ? Date.parse(existing.updated_at) : NaN
        if (
            !Number.isNaN(ghUpdatedAt) &&
            !Number.isNaN(rowUpdatedAt) &&
            rowUpdatedAt > ghUpdatedAt
        ) {
            return ack()
        }

        await svc.from("issues").update(syncFields).eq("id", existing.id)

        // Closing the issue cancels any in-flight analysis — the analyser then
        // reports 'cancelled' via the callback and the placeholder is updated.
        if (action === "closed") {
            after(() => createIssueAnalysisService().cancel(existing.id))
        }
    } else {
        // First time we see this GitHub issue — insert under the project
        // owner's user_id so owner-only RLS keeps reads locked to them. We
        // SKIP the needs_indexing gate (external reporters can't bootstrap the
        // graph — same policy as app/api/public-issues).
        const { data: inserted } = await svc
            .from("issues")
            .insert({
                project_id: project.id,
                user_id: project.user_id,
                ...syncFields,
            })
            .select("id")
            .single<Pick<Issue, "id">>()

        // (8) A brand-new GitHub-origin issue kicks off analysis: post the
        // "analysing…" placeholder + start the detached analyser run (no-ops
        // silently when the graph isn't indexed). Off the 202 ack path.
        if (action === "opened" && inserted) {
            after(() => createIssueAnalysisService().ensure(inserted.id, origin))
        }

        // (8b) …and gets embedded, so it joins the similarity corpus like an
        // in-app issue. This is the fix for GitHub-origin issues being
        // permanently absent from similarity: the row used to land here and
        // never get a vector, and since the similarity RPCs INNER JOIN
        // issue_embeddings it was invisible both as a subject and as a
        // candidate. Unlike analysis above this is NOT gated on 'opened' —
        // every action that inserts a row (an issue first seen via `edited` or
        // `reopened`, say) needs a vector just as much.
        //
        // Fire-and-forget off the ack path, same as the analyser call. If it
        // fails, the embedder's ensureEmbeddings() sweep picks the row up later.
        if (inserted) {
            after(() => createIssueEmbedder().embedIssue({ id: inserted.id, project_id: project.id, title, body }))
        }
    }

    // (9) Ack.
    return ack()
}

// ─── pull-request path ──────────────────────────────────────────────────────

// handlePullRequest mirrors a PR into tracker.pull_requests (all actions, incl.
// drafts + closed/merged, so the Pull-requests tab stays current) and then, for
// opened/reopened/synchronize, kicks the detached analyser review (off the ack
// path); on closed it cancels any in-flight run. Gated on the project being
// App-linked + sync-enabled; the graph-indexed + diff-fetch gates live in
// startPRAnalysis.
async function handlePullRequest(
    svc: Svc,
    payload: Record<string, unknown>,
    action: string,
    origin: string,
): Promise<Response> {
    const repository = payload.repository as { id?: number } | undefined
    const pr = payload.pull_request as
        | {
              number?: number
              node_id?: string
              title?: string
              body?: string | null
              state?: string
              draft?: boolean
              merged?: boolean
              merged_at?: string | null
              html_url?: string
              additions?: number
              deletions?: number
              changed_files?: number
              comments?: number
              created_at?: string
              updated_at?: string
              closed_at?: string | null
              user?: { login?: string; avatar_url?: string }
              base?: { ref?: string; sha?: string }
              head?: { ref?: string; sha?: string }
          }
        | undefined
    const repoId = repository?.id
    const number = pr?.number
    if (!repoId || !number) return ack()

    const { data: project } = await svc
        .from("projects")
        .select("id,repo_url,repo_full_name,github_installation_id,github_repo_id,github_sync_enabled")
        .eq("github_repo_id", repoId)
        .eq("github_sync_enabled", true)
        .maybeSingle<
            Pick<
                Project,
                | "id"
                | "repo_url"
                | "repo_full_name"
                | "github_installation_id"
                | "github_repo_id"
                | "github_sync_enabled"
            >
        >()
    if (!project) return ack()

    // Mirror the PR first (awaited inline — one bounded write — so the row is
    // durable before we ack, exactly like the issues path).
    await createServicePullRequestStore().upsertPullRequest(project.id, {
        pr_number: number,
        github_node_id: pr?.node_id ?? null,
        title: pr?.title ?? "",
        body: pr?.body ?? null,
        state: pr?.state === "closed" ? "closed" : "open",
        merged: pr?.merged ?? !!pr?.merged_at,
        draft: !!pr?.draft,
        author_login: pr?.user?.login ?? null,
        author_avatar_url: pr?.user?.avatar_url ?? null,
        html_url: pr?.html_url ?? null,
        head_ref: pr?.head?.ref ?? null,
        base_ref: pr?.base?.ref ?? null,
        head_sha: pr?.head?.sha ?? null,
        base_sha: pr?.base?.sha ?? null,
        additions: pr?.additions ?? null,
        deletions: pr?.deletions ?? null,
        changed_files: pr?.changed_files ?? null,
        comments_count: pr?.comments ?? null,
        gh_created_at: pr?.created_at ?? null,
        gh_updated_at: pr?.updated_at ?? null,
        closed_at: pr?.closed_at ?? null,
        merged_at: pr?.merged_at ?? null,
    })

    // Closing a PR cancels any in-flight review (state already mirrored above).
    if (action === "closed") {
        after(() => createPullRequestAnalysisService().cancel(project.id, number))
        return ack()
    }

    // opened | reopened | synchronize → review. Skip drafts (still mirrored).
    if (pr?.draft) return ack()
    after(() =>
        createPullRequestAnalysisService().start(
            project,
            {
                number,
                title: pr?.title ?? "",
                body: pr?.body ?? null,
                baseSha: pr?.base?.sha ?? null,
                headSha: pr?.head?.sha ?? null,
            },
            origin,
        ),
    )
    return ack()
}

// ─── push → incremental graph update ────────────────────────────────────────

// handlePush turns a default-branch push into an incremental graph update.
// The heavy lifting (clone, diff, smart-update) runs on the analyser; here we
// only map repo→project, confirm the project has an indexed graph, and enqueue.
// The analyser's coalescing queue collapses a burst of pushes to the same repo
// into a single re-index at the latest commit, so we forward every qualifying
// push (even mid-update) rather than debouncing here.
async function handlePush(svc: Svc, payload: Record<string, unknown>): Promise<Response> {
    const repository = payload.repository as { id?: number; default_branch?: string } | undefined
    const ref = String((payload as { ref?: unknown }).ref ?? "")
    const headSha = String((payload as { after?: unknown }).after ?? "")
    const deleted = (payload as { deleted?: unknown }).deleted === true
    const repoId = repository?.id
    if (!repoId || !ref) return ack()

    // Only the default branch drives the graph. Feature-branch and tag pushes
    // are ignored so the graph tracks the canonical branch (no thrashing).
    const defaultBranch = repository?.default_branch
    if (!defaultBranch || ref !== `refs/heads/${defaultBranch}`) return ack()

    // Branch deletion (or an all-zero head) has nothing to index.
    if (deleted || /^0+$/.test(headSha)) return ack()

    // Auto-index is its own toggle (setup page), independent of issue/PR sync.
    // The webhook only reaches us when the App is installed, and github_repo_id
    // was set at install — so no extra install check is needed here.
    const { data: project } = await svc
        .from("projects")
        .select("id,user_id,repo_url,github_repo_id,auto_index_on_push")
        .eq("github_repo_id", repoId)
        .maybeSingle<Pick<Project, "id" | "user_id" | "repo_url" | "github_repo_id" | "auto_index_on_push">>()
    if (!project || !project.auto_index_on_push) return ack()

    // Incremental needs a prior successful bootstrap: a graph_id must exist.
    // We deliberately do NOT gate on status==='ready' — a push that lands
    // mid-update must still reach the analyser so its queue can coalesce it.
    const analyser = await tryOrNull(() =>
        createSupabaseProjectAnalyserRepository(svc).findByProjectId(project.id),
    )
    if (!analyser?.enabled || !analyser.graph_id) return ack()

    // Already indexed at this exact commit → nothing to do (the analyser would
    // no-op too, but skipping saves a clone + a queue round-trip).
    if (analyser.last_indexed_sha && analyser.last_indexed_sha === headSha) return ack()

    const graphId = analyser.graph_id
    after(async () => {
        try {
            await getAnalyser().startIndex({
                job_type: "incremental",
                repo_url: project.repo_url,
                repo_id: graphId,
                // NB: deliberately NO repo_ref. The analyser shallow-clones
                // (`--depth`, so `--single-branch`) and already lands on the
                // default-branch tip — a second `git checkout <ref>` on top of
                // that fails (an arbitrary SHA isn't fetched; even the branch name
                // errors in a single-branch shallow clone). The manual re-index
                // works the same way (no ref). Incremental reads HEAD, and
                // coalescing means "index to latest", so the tip is what we want.
                // The analyser worker fetches this owner's GitHub token from
                // tracker.github_tokens to clone — no credential crosses the wire.
                user_id: project.user_id,
                supabase_progress: { key_value: project.id },
            })
        } catch (e) {
            // Best-effort: a transient kickoff failure is retried by the next
            // push. Don't flip the project to 'failed' over a delivery hiccup.
            console.error("[webhook] push → incremental kickoff failed", project.id, e)
        }
    })
    return ack()
}

// ─── PR comment sync ────────────────────────────────────────────────────────

// handlePrComment mirrors a PR's conversation comments (issue_comment, incl.
// Bobby's own bot comment) and review summaries (pull_request_review, when the
// review carries a note) into tracker.pr_comments; plain-issue comments are
// forwarded to handleIssueComment. Echo suppression is implicit: webhook upserts
// omit `provenance`, so a conflicting write (a tracker comment bouncing back)
// keeps the existing 'tracker' provenance + author while the DB default makes
// fresh mirrors 'github'.
async function handlePrComment(
    svc: Svc,
    event: string,
    payload: Record<string, unknown>,
): Promise<Response> {
    const repository = payload.repository as { id?: number } | undefined
    const repoId = repository?.id
    if (!repoId) return ack()

    const { data: project } = await svc
        .from("projects")
        .select("id")
        .eq("github_repo_id", repoId)
        .eq("github_sync_enabled", true)
        .maybeSingle<{ id: string }>()
    if (!project) return ack()

    const action = String((payload as { action?: unknown }).action ?? "")

    if (event === "issue_comment") {
        const issue = payload.issue as { number?: number; pull_request?: unknown } | undefined
        if (!issue?.number) return ack()
        // A comment without a pull_request ref is a plain-issue comment.
        if (!issue.pull_request) return handleIssueComment(svc, project.id, action, payload)
        const comment = payload.comment as
            | {
                  id?: number
                  body?: string | null
                  html_url?: string
                  user?: { login?: string; avatar_url?: string }
                  created_at?: string
                  updated_at?: string
              }
            | undefined
        if (!comment?.id) return ack()

        if (action === "deleted") {
            await createServicePullRequestStore().deleteComment(project.id, "issue_comment", comment.id)
            return ack()
        }
        await createServicePullRequestStore().upsertComment(project.id, {
            pr_number: issue.number,
            source: "issue_comment",
            github_comment_id: comment.id,
            author_login: comment.user?.login ?? null,
            author_avatar_url: comment.user?.avatar_url ?? null,
            body: comment.body ?? null,
            html_url: comment.html_url ?? null,
            gh_created_at: comment.created_at ?? null,
            gh_updated_at: comment.updated_at ?? null,
        })
        return ack()
    }

    // pull_request_review — store a review's summary body (skip bodiless
    // approvals and dismissals, which are status, not a comment).
    const prr = payload.pull_request as { number?: number } | undefined
    const review = payload.review as
        | {
              id?: number
              body?: string | null
              html_url?: string
              user?: { login?: string; avatar_url?: string }
              submitted_at?: string | null
          }
        | undefined
    if (!prr?.number || !review?.id || action === "dismissed") return ack()
    if (!review.body?.trim()) return ack()
    await createServicePullRequestStore().upsertComment(project.id, {
        pr_number: prr.number,
        source: "review",
        github_comment_id: review.id,
        author_login: review.user?.login ?? null,
        author_avatar_url: review.user?.avatar_url ?? null,
        body: review.body,
        html_url: review.html_url ?? null,
        gh_created_at: review.submitted_at ?? null,
        gh_updated_at: review.submitted_at ?? null,
    })
    return ack()
}

// handleIssueComment mirrors a plain-issue conversation comment into
// tracker.issue_comments. Same implicit echo suppression as handlePrComment
// (omitting `provenance` preserves a tracker row's ownership on the bounce-back).
async function handleIssueComment(
    svc: Svc,
    projectId: string,
    action: string,
    payload: Record<string, unknown>,
): Promise<Response> {
    const issue = payload.issue as { number?: number } | undefined
    const comment = payload.comment as
        | {
              id?: number
              body?: string | null
              html_url?: string
              user?: { login?: string; avatar_url?: string }
              created_at?: string
              updated_at?: string
          }
        | undefined
    if (!issue?.number || !comment?.id) return ack()

    if (action === "deleted") {
        await createServiceIssueSyncStore().deleteComment(projectId, comment.id)
        return ack()
    }
    await createServiceIssueSyncStore().upsertComment(projectId, {
        issue_number: issue.number,
        github_comment_id: comment.id,
        author_login: comment.user?.login ?? null,
        author_avatar_url: comment.user?.avatar_url ?? null,
        body: comment.body ?? null,
        html_url: comment.html_url ?? null,
        gh_created_at: comment.created_at ?? null,
        gh_updated_at: comment.updated_at ?? null,
    })
    return ack()
}
