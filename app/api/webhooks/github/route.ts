import { after } from "next/server"
import { verifyWebhookSignature } from "@/lib/github-app"
import { allowsInbound, cancelAnalysis, ensureAnalysis, stateToStatus, syncHash } from "@/lib/github-sync"
import { cancelPRAnalysisForPR, startPRAnalysis } from "@/lib/pr-sync"
import { deletePRComment, upsertPRComment, upsertPullRequest } from "@/lib/pr-store"
import { createServiceClient } from "@/lib/supabase/server"
import type { Issue, Project } from "@/lib/supabase/types"

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

    // (2) Verify HMAC-SHA256 over the raw body against x-hub-signature-256.
    const signature = request.headers.get("x-hub-signature-256")
    if (!(await verifyWebhookSignature(raw, signature))) {
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
    if (!allowsInbound(project)) return ack()

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
    const hash = await syncHash(title, body, state)
    if (existing && existing.last_synced_hash === hash) return ack()

    const nowIso = new Date().toISOString()
    const syncFields = {
        title,
        body,
        status: stateToStatus(state),
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
            after(() => cancelAnalysis(existing.id))
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
            after(() => ensureAnalysis(inserted.id, origin))
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
    await upsertPullRequest(svc, project.id, {
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
        after(() => cancelPRAnalysisForPR(project.id, number))
        return ack()
    }

    // opened | reopened | synchronize → review. Skip drafts (still mirrored).
    if (pr?.draft) return ack()
    after(() =>
        startPRAnalysis(
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

// ─── PR comment sync ────────────────────────────────────────────────────────

// handlePrComment mirrors a PR's conversation comments (issue_comment, incl.
// Bobby's own bot comment) and review summaries (pull_request_review, when the
// review carries a note) into tracker.pr_comments. issue_comment fires for
// plain issues too — handled only when the issue carries a pull_request ref.
// No echo suppression: v1 never posts comments from the tracker.
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
        // Only PR comments carry a pull_request ref; plain-issue comments are out.
        if (!issue?.pull_request || !issue.number) return ack()
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
            await deletePRComment(svc, project.id, "issue_comment", comment.id)
            return ack()
        }
        await upsertPRComment(svc, project.id, {
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
    await upsertPRComment(svc, project.id, {
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
