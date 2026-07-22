import { AnalyserError, createSupabaseProjectAnalyserRepository, getAnalyser } from "@/modules/analysis"
import { jsonError, repoRead, requireProjectAccess } from "@/lib/server/http/api"
import { RepositoryError } from "@/lib/shared/kernel"
import type { Project } from "@/lib/shared/types"

// POST /api/projects/[id]/verify
//
// Synchronous graph-health check. No LLM calls; the analyser server
// clones the repo on demand and validates every note's file:line
// citations + measures last-commit drift. Returns the structured
// VerifyReport for the panel to render.
//
// 409 needs_indexing — mirrors the suggest/ask routes when project_analyser
// isn't ready.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { supabase, user, error } = await requireProjectAccess(id)
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

    const { data: analyser, error: aErr } = await repoRead(() =>
        createSupabaseProjectAnalyserRepository(supabase).findByProjectId(id),
    )
    if (aErr) return aErr
    if (!analyser?.enabled || analyser.status !== "ready" || !analyser.graph_id) {
        return jsonError(
            "needs_indexing",
            "Enable bobby-analyser and run an index for this project before verifying.",
            409,
        )
    }

    try {
        const report = await getAnalyser().verify({
            repoUrl: project.repo_url,
            repoId: analyser.graph_id,
            // The analyser worker fetches this user's GitHub token from
            // tracker.github_tokens to clone private repos — no token over
            // the wire. gitToken stays as an optional explicit override.
            userId: user.id,
            gitToken,
        })
        // Persist the latest report on the project_analyser row so:
        //   - The verify panel renders cached data on page load (no
        //     "click verify" empty state).
        //   - Any future verify run (post-update QC, post-bootstrap QC,
        //     manual button) overwrites it; realtime subscribers pick
        //     up the change.
        // Best-effort: a Supabase failure here doesn't fail the response
        // (the report is still returned to the client this round-trip).
        try {
            await createSupabaseProjectAnalyserRepository(supabase).saveHealthReport(
                id,
                report,
                new Date().toISOString(),
            )
        } catch (e) {
            if (!(e instanceof RepositoryError)) throw e
            console.warn("verify: persist failed:", e.message)
        }
        return Response.json(report)
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        const code = e instanceof AnalyserError ? e.code : "verify_failed"
        return jsonError(code, message, 502)
    }
}
