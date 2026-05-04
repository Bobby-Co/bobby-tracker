import { jsonError, requireUser } from "@/lib/api"

// POST — add a project to a group. Membership row's RLS with-check
// already enforces same-owner on both sides, so a stray project id
// returns a row-level error rather than silently linking.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { supabase, error } = await requireUser()
    if (error) return error

    let body: Record<string, unknown>
    try { body = await request.json() } catch { return jsonError("bad_request", "invalid JSON", 400) }

    const project_id = typeof body.project_id === "string" ? body.project_id.trim() : ""
    if (!project_id) return jsonError("bad_request", "project_id required", 400)

    const { error: dbErr } = await supabase
        .from("project_group_members")
        .insert({ group_id: id, project_id })
    if (dbErr) {
        if (dbErr.code === "23505") return jsonError("conflict", "project already in group", 409)
        return jsonError("db_error", dbErr.message, 500)
    }
    return Response.json({ ok: true })
}
