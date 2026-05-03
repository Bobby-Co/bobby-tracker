import { jsonError, requireUser } from "@/lib/api"
import type { ProjectPublicIntegration } from "@/lib/supabase/types"

// Per-project toggle for the public-submissions integration.
// Disabling also removes the project from any sessions that cover it,
// so an off-state is meaningfully off (no surprise submissions can
// trickle in via still-active session memberships).

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { supabase, error } = await requireUser()
    if (error) return error
    const { data } = await supabase
        .from("project_public_integration")
        .select("*")
        .eq("project_id", id)
        .maybeSingle<ProjectPublicIntegration>()
    return Response.json({
        integration: data ?? { project_id: id, enabled: false, created_at: null, updated_at: null },
    })
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { supabase, error } = await requireUser()
    if (error) return error

    let body: Record<string, unknown>
    try { body = await request.json() } catch { return jsonError("bad_request", "invalid JSON", 400) }
    if (typeof body.enabled !== "boolean") return jsonError("bad_request", "enabled (boolean) required", 400)
    const enabled = body.enabled

    const { data, error: dbErr } = await supabase
        .from("project_public_integration")
        .upsert({ project_id: id, enabled }, { onConflict: "project_id" })
        .select("*")
        .single<ProjectPublicIntegration>()
    if (dbErr) return jsonError("db_error", dbErr.message, 500)

    if (!enabled) {
        // Drop the project from any sessions covering it. Submissions
        // through the link will then 400 because the project_id is no
        // longer in the session's coverage list.
        const { error: unlinkErr } = await supabase
            .from("public_session_projects")
            .delete()
            .eq("project_id", id)
        if (unlinkErr) return jsonError("db_error", unlinkErr.message, 500)
    }

    return Response.json({ integration: data })
}
