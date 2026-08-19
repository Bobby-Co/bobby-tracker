import { AnalyserError, getAnalyser } from "@/modules/analysis"
import { getGitlabCloneAuth } from "@/modules/vcs"
import { ApiContext, jsonError, repoRead } from "@/lib/server/http/api"
import { tryOrNull } from "@/lib/shared/kernel"
import type { AnalyserProgress } from "@/lib/shared/types"

// POST /api/projects/[id]/analyser/index
//
// Netlify-safe kickoff: returns within ~150ms. The analyser runs the
// indexing in its own detached goroutine and PATCHes progress + final
// state directly to tracker.project_analyser via PostgREST using the
// SUPABASE_* env vars on the ANALYSER's host. No service-role key
// crosses the wire from this side.
//
// Body:
//   - job_type?   "bootstrap" (default) or "incremental"
//
// Private-repo auth: the analyser worker fetches this user's GitHub token
// from tracker.github_tokens itself (keyed by the user_id we send). The
// tracker no longer reads the token or ships it over the wire.
//
// Incremental requires a prior successful bootstrap of the same
// project; the analyser surfaces a clean "bootstrap first?" error
// otherwise and the catch block below records it as a failed run.
//
// This route just:
//   1. Auth + load project
//   2. Mark status='indexing' so the UI flips immediately
//   3. POST to analyser /jobs/run with the project_id (row key) and
//      the requested job_type
//   4. Return 202
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { ctx, teamId, user, error } = await new ApiContext().requireProjectAccess(id)
    if (error) return error

    // Hard gate: a paused team may read everything and run nothing (0076). Sits
    // after the access guard because a pause is a billing state, not a permission
    // — the 402 tells the client to offer resume/plan, not sign-in.
    const spendErr = await new ApiContext().requireSpend(ctx, teamId)
    if (spendErr) return spendErr

    let body: Record<string, unknown> = {}
    try { body = await request.json() } catch {}
    const jobType: "bootstrap" | "incremental" =
        body?.job_type === "incremental" ? "incremental" : "bootstrap"
    // Indexing depth for a bootstrap. The setup wizard passes the user's choice
    // (medium recommended); the manual re-index button omits it → "low" default
    // to keep spend predictable. Ignored by the analyser on incremental jobs.
    const effort: "low" | "medium" | "high" =
        body?.effort === "medium" || body?.effort === "high" ? body.effort : "low"

    const project = await tryOrNull(() => ctx.projects.findFull(id))
    if (!project) return jsonError("not_found", "project not found", 404)

    // Flip the UI to "Indexing…" right away. Realtime delivers this
    // to subscribers instantly; the analyser will overwrite progress
    // updates as the job runs.
    const initialPhase = jobType === "incremental" ? "Update — starting…" : "Starting…"
    const initial: AnalyserProgress = { phase: initialPhase, started_at: new Date().toISOString() }
    const { error: upErr } = await repoRead(() => ctx.analyser.markIndexing(id, initial))
    if (upErr) return upErr

    // GitLab private-repo clone: the analyser's user_id path reads github_tokens
    // (GitLab-blind), so we pass an explicit git_auth (bot token + oauth2 user).
    // Null for GitHub / public / unprovisioned → the user_id path is used as before.
    const gitAuth = await getGitlabCloneAuth(id)

    const cell = await ctx.projects.findCell(id)
    if (!cell) return jsonError("placement_unavailable", "This project's data location is unavailable.", 503)

    try {
        const result = await getAnalyser(cell).startIndex({
            job_type: jobType,
            repo_url: project.repo_url,
            // Effort scales grouper aggressiveness + per-cluster turn budget on
            // the analyser side. From the wizard this is the user's pick; the
            // manual re-index button leaves it "low". Ignored on incremental.
            effort,
            // The analyser worker fetches this user's GitHub token from
            // tracker.github_tokens (keyed by user_id) to clone private
            // repos — no credential crosses the wire from here.
            user_id: user.id,
            ...(gitAuth ? { git_auth: gitAuth } : {}),
            // Connection details (Supabase URL, service-role JWT,
            // schema, table, key column) live in the analyser's env.
            // We send only the row key to PATCH.
            supabase_progress: { key_value: id },
        })
        return Response.json(
            { status: "accepted", job_id: result.job_id, project_id: id, job_type: jobType },
            { status: 202 },
        )
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        const code = e instanceof AnalyserError ? e.code : "kickoff_failed"
        // Roll back the optimistic 'indexing' upsert so the UI doesn't
        // get stuck at "Starting…" if the analyser was unreachable.
        // Best-effort: a failed rollback must not mask the real 502.
        await ctx.analyser.markFailed(id, message).catch(() => {})
        return jsonError(code, message, 502)
    }
}
