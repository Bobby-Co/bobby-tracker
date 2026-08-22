import { jsonError } from "@/lib/server/http/api"
import { dataClientForProject } from "@/lib/server/regional"
import { Supabase } from "@/lib/server/supabase"

export const dynamic = "force-dynamic"

// GET /api/internal/pr-review-preflight?project=<uuid>
//
// Can this deployment actually run a PR review for this project? Asked the way
// the pipeline asks it — through the app's own Supabase client, with the app's
// own environment, against whichever cell the project resolves to.
//
// ─── Why this exists next to the SQL preflight ───────────────────────────────
//
// scripts/preflight-pr-review.sql asks Postgres directly and is worth running,
// but it cannot see the three things that actually broke this pipeline:
//
//   GRANTS        psql connects as the owner, which bypasses them. A container
//                 test passed here while the live insert failed with permission
//                 denied, because the owner never needed the grant the service
//                 role did not have.
//   SCHEMA CACHE  PostgREST answers from a cached schema. A table can be present,
//                 columned and granted, and still come back PGRST205 until the
//                 cache is reloaded. SQL cannot observe that at all.
//   WHICH DATABASE  a psql session is pointed by hand. This resolves the cell the
//                 way the pipeline does, so it reads what the pipeline reads —
//                 which is the question when the project lives in bangkok-0 and
//                 the migration was applied somewhere else.
//
// So this performs the real operations, including a WRITE, and reports the exact
// error each one returns rather than the null the pipeline turns it into.
//
// Read-mostly: the one write is a probe round on a sentinel PR number, deleted
// immediately, and it is the only check that can catch a missing grant, a
// cross-plane foreign key or a stale cache — all three of which are invisible to
// every read.

/** A PR number no real pull request will have, so a probe row cannot collide
 *  with a real round or be mistaken for one if the delete fails. */
const PROBE_PR = -1

interface Check {
    step: string
    ok: boolean
    detail: string
    /** The provider's own error code, which is the part worth grepping for. */
    code?: string
    remedy?: string
}

export async function GET(request: Request) {
    const expected = process.env.BOBBY_ANALYSER_TOKEN
    if (!expected) return jsonError("not_configured", "preflight is not configured", 503)
    const auth = request.headers.get("authorization") ?? ""
    if ((auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "") !== expected) {
        return jsonError("unauthorized", "bad analyser token", 401)
    }

    const projectId = new URL(request.url).searchParams.get("project")
    if (!projectId) return jsonError("bad_request", "?project=<uuid> is required", 400)

    const checks: Check[] = []
    const add = (step: string, error: { message: string; code?: string } | null, remedy?: string) =>
        checks.push({
            step,
            ok: !error,
            detail: error ? error.message : "ok",
            ...(error?.code ? { code: error.code } : {}),
            ...(error && remedy ? { remedy } : {}),
        })

    // 1. Which cell, and therefore which database. Everything after this is read
    //    against whatever this resolves to — which is the whole point.
    let db
    let cell = "unresolved"
    try {
        const control = Supabase.service()
        const { data } = await control.from("projects").select("cell").eq("id", projectId).maybeSingle<{ cell: string | null }>()
        cell = data?.cell ?? "home"
        db = await dataClientForProject(projectId)
        add("resolve cell", null)
    } catch (e) {
        add("resolve cell", { message: e instanceof Error ? e.message : String(e) })
        return Response.json({ project: projectId, cell, ok: false, checks }, { status: 200 })
    }

    // 2. The reads, in the order start() makes them. Each returns null on failure
    //    and the pipeline reads null as "nothing here" — so the error is the
    //    interesting part, not the data.
    const tracking = await db
        .from("pull_request_analyses")
        .select("id,status,github_comment_id,head_sha,pending_head_sha,review_profile,review_scope")
        .eq("project_id", projectId)
        .limit(1)
    add("read pull_request_analyses", tracking.error, "re-run migrations 0079/0080/0081, then: notify pgrst, 'reload schema';")

    const rounds = await db
        .from("pull_request_analysis_rounds")
        .select("head_sha,round,status,verdict,score,score_max,findings,degraded,review_profile,analyser_build,created_at,scope,scope_reason,prev_head_sha,base_sha,commits,carried_count,reviewed_files,resolved")
        .eq("project_id", projectId)
        .limit(1)
    add(
        "read pull_request_analysis_rounds",
        rounds.error,
        "this read failing is why every round looks like a FIRST round — re-run 0081, then reload the schema cache",
    )

    // 3. The write. The only check that catches a missing grant, a cross-plane
    //    foreign key, or a schema cache that has not seen the table — none of
    //    which any read above can detect, and all three of which have shipped.
    const probe = await db.from("pull_request_analysis_rounds").insert({
        project_id: projectId,
        pr_number: PROBE_PR,
        head_sha: "preflight",
        round: 1,
        status: "preflight",
        findings: [],
        degraded: false,
    })
    add(
        "write pull_request_analysis_rounds",
        probe.error,
        probe.error?.code === "23503"
            ? "cross-plane foreign key — run migration 0083 against THIS cell's database"
            : probe.error?.code === "42501"
              ? "missing grant — run migration 0082 against THIS cell's database"
              : probe.error?.code === "PGRST205"
                ? "PostgREST has not seen this table — notify pgrst, 'reload schema';"
                : "the round cannot be recorded, so incremental review can never engage",
    )

    // Always attempt the cleanup, even if the insert reported failure — a partial
    // write is exactly the case where a leftover sentinel row would be worst.
    const cleanup = await db
        .from("pull_request_analysis_rounds")
        .delete()
        .eq("project_id", projectId)
        .eq("pr_number", PROBE_PR)
    add("remove the probe row", cleanup.error, "delete it by hand: pr_number = -1")

    const ok = checks.every((c) => c.ok)
    return Response.json(
        {
            project: projectId,
            cell,
            ok,
            summary: ok
                ? "this deployment can record rounds for this project — incremental review will engage"
                : "at least one step fails SILENTLY in the pipeline; see remedy on each",
            checks,
        },
        { status: 200 },
    )
}
