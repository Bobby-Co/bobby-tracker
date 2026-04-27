import { runJob, type JobProgress } from "@/lib/analyser"
import { jsonError, requireUser } from "@/lib/api"
import { createServiceClient } from "@/lib/supabase/server"
import type { AnalyserProgress, Project, ProjectAnalyser } from "@/lib/supabase/types"

// POST /api/projects/[id]/analyser/index
//
// Fire-and-forget: returns 202 the moment the job is accepted, then
// runs the indexing in the background and writes progress / final state
// to tracker.project_analyser. Clients render from that row via
// Supabase Realtime — no HTTP stream to keep open, no reconnection
// problem when the proxy / network blips.
//
// Run on `next start` on a node host. Vercel functions would kill the
// background work after the response returns; not supported here.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { supabase, error } = await requireUser()
    if (error) return error

    let body: Record<string, unknown> = {}
    try { body = await request.json() } catch {}
    const gitToken = typeof body?.git_token === "string" && body.git_token ? body.git_token : undefined

    const { data: project, error: pErr } = await supabase
        .from("projects")
        .select("*")
        .eq("id", id)
        .single<Project>()
    if (pErr || !project) return jsonError("not_found", "project not found", 404)

    // Background work outlives the request, so the user's session token
    // can't be trusted to still be valid when we write the terminal
    // status. Require the service-role key explicitly so this fails
    // fast at deploy time instead of producing zombie jobs that can't
    // mark themselves done.
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
        return jsonError(
            "config_missing",
            "Tracker is missing SUPABASE_SERVICE_ROLE_KEY env var (required for background indexing writes).",
            500,
        )
    }

    // Mark indexing immediately. Realtime delivers this to subscribers,
    // so the UI flips to "Indexing…" without waiting for the first
    // progress event.
    const { error: upErr } = await supabase
        .from("project_analyser")
        .upsert(
            {
                project_id: id,
                enabled: true,
                status: "indexing",
                last_error: null,
                progress: { phase: "Starting…", started_at: new Date().toISOString() } satisfies AnalyserProgress,
            },
            { onConflict: "project_id" },
        )
    if (upErr) return jsonError("db_error", upErr.message, 500)

    // Detach the work from the request lifecycle. Use the service-role
    // client so the background job's writes aren't affected by the
    // request's session expiring mid-run.
    console.log(`[analyser-index] starting background job project=${id} repo=${project.repo_url}`)
    void runIndexingJob(id, project, gitToken).catch((e) => {
        console.error(`[analyser-index] background job crashed project=${id}`, e)
    })

    return Response.json(
        { status: "indexing", project_id: id },
        { status: 202 },
    )
}

async function runIndexingJob(projectId: string, project: Project, gitToken: string | undefined) {
    const admin = createServiceClient()
    const startedAt = new Date().toISOString()

    // Throttle DB writes: progress events arrive in bursts (~every 100
    // ms during cluster work). Coalesce to once per second per
    // project_id row to keep load on Postgres + realtime sane.
    let pending: AnalyserProgress | null = null
    let lastFlushAt = 0
    let flushTimer: ReturnType<typeof setTimeout> | null = null

    function flush() {
        if (!pending) return
        const snapshot = pending
        pending = null
        lastFlushAt = Date.now()
        if (flushTimer) {
            clearTimeout(flushTimer)
            flushTimer = null
        }
        void admin
            .from("project_analyser")
            .update({ progress: snapshot })
            .eq("project_id", projectId)
            .then(({ error }) => {
                if (error) console.error(`[analyser-index] progress write failed project=${projectId}`, error)
            })
    }

    function bump(next: AnalyserProgress) {
        pending = { ...(pending ?? {}), ...next, started_at: pending?.started_at ?? startedAt }
        const now = Date.now()
        if (now - lastFlushAt >= 1000) {
            flush()
            return
        }
        if (flushTimer) return
        flushTimer = setTimeout(flush, 1000 - (now - lastFlushAt))
    }

    try {
        let firstEventLogged = false
        const result = await runJob(
            {
                repo_url: project.repo_url,
                effort: "medium",
                git_auth: gitToken
                    ? { token: gitToken, username: "x-access-token", scheme: "basic" }
                    : undefined,
            },
            {
                onAccepted: (jobId) => console.log(`[analyser-index] accepted project=${projectId} job=${jobId}`),
                onProgress: (p: JobProgress) => {
                    if (!firstEventLogged) {
                        console.log(`[analyser-index] first progress event project=${projectId} kind=${p.kind}`)
                        firstEventLogged = true
                    }
                    const snap: AnalyserProgress = {
                        phase: humanPhase(p),
                        slug: p.slug,
                        step_idx: p.index,
                        step_total: p.total,
                        cost_usd: p.cumulative_usd,
                        message: p.message,
                    }
                    bump(snap)
                },
            },
        )
        // Make sure the last progress lands before the terminal write.
        flush()
        console.log(`[analyser-index] complete project=${projectId} graph=${result.repo_id} cost=$${result.cost_usd}`)

        await admin
            .from("project_analyser")
            .upsert(
                {
                    project_id: projectId,
                    enabled: true,
                    status: "ready",
                    graph_id: result.repo_id || null,
                    last_indexed_at: new Date().toISOString(),
                    last_indexed_sha: result.head_sha || null,
                    last_index_cost_usd: result.cost_usd || 0,
                    last_error: null,
                    progress: {} satisfies AnalyserProgress,
                } satisfies Partial<ProjectAnalyser>,
                { onConflict: "project_id" },
            )
    } catch (e) {
        flush()
        const message = e instanceof Error ? e.message : String(e)
        console.error(`[analyser-index] failed project=${projectId} err=${message}`)
        await admin
            .from("project_analyser")
            .upsert(
                {
                    project_id: projectId,
                    enabled: true,
                    status: "failed",
                    last_error: message,
                    progress: {} satisfies AnalyserProgress,
                },
                { onConflict: "project_id" },
            )
    }
}

function humanPhase(p: JobProgress): string {
    switch (p.kind) {
        case "clone_start":     return "Cloning repo…"
        case "clone_end":       return "Clone complete"
        case "phase1_start":    return "Phase 1 — discovery"
        case "phase1_end":      return "Phase 1 complete"
        case "grouper_start":   return "Grouping modules"
        case "grouper_end":     return "Groups ready"
        case "phase2_start":    return "Phase 2 — clusters"
        case "module_start":    return p.slug ? `Indexing ${p.slug}` : "Indexing module"
        case "module_complete": return p.slug ? `Done ${p.slug}` : "Module done"
        case "module_fail":     return p.slug ? `Failed ${p.slug}` : "Module failed"
        case "usage":           return "Model call"
        case "budget_stop":     return "Budget reached"
        case "bootstrap_end":   return "Bootstrap complete"
        default:                return p.message || p.kind
    }
}
