import {
    AnalyserError,
    getIssuePreferences,
    isAnalyseEffort,
    setIssuePreferences,
} from "@/lib/analyser"
import { jsonError, requireUser } from "@/lib/api"
import type { ProjectAnalyser } from "@/lib/supabase/types"

// GET/PUT /api/projects/[id]/issue-preferences
//
// Per-project default analyse effort. Stored on the bobby-analyser side and
// keyed by repo_id — which for a tracker project is its indexed graph_id (the
// same mapping the /issues/analyse call uses). This route proxies to the
// analyser's /issues/preferences using the server-only bearer token.
//
// A project that has never indexed has no graph_id, so there's no repo the
// analyser knows about: GET reports an empty default, PUT returns 409.

async function resolveGraphId(projectId: string) {
    const { supabase, error } = await requireUser()
    if (error) return { error } as const
    const { data, error: dbErr } = await supabase
        .from("project_analyser")
        .select("graph_id")
        .eq("project_id", projectId)
        .maybeSingle<Pick<ProjectAnalyser, "graph_id">>()
    if (dbErr) return { error: jsonError("db_error", dbErr.message, 500) } as const
    return { graphId: data?.graph_id ?? null } as const
}

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const resolved = await resolveGraphId(id)
    if ("error" in resolved) return resolved.error

    // Not indexed yet → no repo the analyser knows about. Report no default
    // rather than erroring, so the settings UI can render a neutral state.
    if (!resolved.graphId) return Response.json({ effort: "", indexed: false })

    try {
        const prefs = await getIssuePreferences(resolved.graphId)
        return Response.json({ effort: prefs.effort ?? "", indexed: true })
    } catch (e) {
        const code = e instanceof AnalyserError ? e.code : "analyser_failed"
        const message = e instanceof Error ? e.message : String(e)
        return jsonError(code, message, 502)
    }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params

    let body: Record<string, unknown>
    try { body = await request.json() } catch { return jsonError("bad_request", "invalid JSON", 400) }

    // "" clears the default; otherwise it must be a known effort level.
    const raw = body?.effort
    if (raw !== "" && !isAnalyseEffort(raw)) {
        return jsonError("bad_request", "effort must be one of fast, medium, high, veryhigh (or \"\" to clear)", 400)
    }
    const effort = raw as Parameters<typeof setIssuePreferences>[1]

    const resolved = await resolveGraphId(id)
    if ("error" in resolved) return resolved.error
    if (!resolved.graphId) {
        return jsonError("needs_indexing", "Index this project before setting an analyser effort default.", 409)
    }

    try {
        const prefs = await setIssuePreferences(resolved.graphId, effort)
        return Response.json({ effort: prefs.effort ?? "", indexed: true })
    } catch (e) {
        const code = e instanceof AnalyserError ? e.code : "analyser_failed"
        const message = e instanceof Error ? e.message : String(e)
        return jsonError(code, message, 502)
    }
}
