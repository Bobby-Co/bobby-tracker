import { jsonError, requireUser } from "@/lib/api"
import type { Issue } from "@/lib/supabase/types"

// POST /api/issues/[id]/duplicate-of
//
// Body: { duplicate_of_issue_id: string | null }
//
// Marks (or unmarks) the issue as a duplicate of another. We require
// both issues to belong to the same project — otherwise the link
// would suggest cross-project deduplication, which isn't a thing in
// our model. Both ownership checks ride on RLS: the user can only
// touch issues in projects they own.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { supabase, error } = await requireUser()
    if (error) return error

    let body: Record<string, unknown>
    try { body = await request.json() } catch { return jsonError("bad_request", "invalid JSON", 400) }

    const target = body.duplicate_of_issue_id
    const targetId = typeof target === "string" && target.length > 0 ? target : null

    if (targetId === id) {
        return jsonError("bad_request", "An issue can't be a duplicate of itself.", 400)
    }

    if (targetId) {
        // Same-project check. The two issues must share a project_id
        // — duplicates across projects don't make sense here.
        const { data: rows, error: lookupErr } = await supabase
            .from("issues")
            .select("id,project_id")
            .in("id", [id, targetId])
            .returns<Pick<Issue, "id" | "project_id">[]>()
        if (lookupErr) return jsonError("db_error", lookupErr.message, 500)
        if (!rows || rows.length !== 2) {
            return jsonError("not_found", "issue or target not found", 404)
        }
        if (rows[0].project_id !== rows[1].project_id) {
            return jsonError("bad_request", "Both issues must belong to the same project.", 400)
        }
    }

    const { data, error: upErr } = await supabase
        .from("issues")
        .update({ duplicate_of_issue_id: targetId })
        .eq("id", id)
        .select("id,duplicate_of_issue_id")
        .single<Pick<Issue, "id" | "duplicate_of_issue_id">>()
    if (upErr) return jsonError("db_error", upErr.message, 500)

    return Response.json({ issue: data })
}
