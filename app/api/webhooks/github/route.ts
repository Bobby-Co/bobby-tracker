import { after } from "next/server"
import { verifyWebhookSignature } from "@/lib/github-app"
import { allowsInbound, cancelAnalysis, startAnalysis, stateToStatus, syncHash } from "@/lib/github-sync"
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
            after(() => startAnalysis(inserted.id, origin))
        }
    }

    // (9) Ack.
    return ack()
}
