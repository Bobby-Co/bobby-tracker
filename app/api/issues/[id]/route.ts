import { jsonError, requireUser } from "@/lib/api"
import { ISSUE_PRIORITIES, ISSUE_STATUSES } from "@/lib/supabase/types"
import type { Issue } from "@/lib/supabase/types"

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { supabase, error } = await requireUser()
    if (error) return error

    let body: Record<string, unknown>
    try { body = await request.json() } catch { return jsonError("bad_request", "invalid JSON", 400) }

    const patch: Record<string, unknown> = {}
    if (typeof body.title === "string" && body.title.trim()) patch.title = body.title.trim()
    if (typeof body.body === "string") patch.body = body.body
    if (typeof body.status === "string" && (ISSUE_STATUSES as readonly string[]).includes(body.status)) patch.status = body.status
    if (typeof body.priority === "string" && (ISSUE_PRIORITIES as readonly string[]).includes(body.priority)) patch.priority = body.priority
    if (Array.isArray(body.labels)) patch.labels = body.labels.filter((l: unknown) => typeof l === "string")
    if (Object.keys(patch).length === 0) return jsonError("bad_request", "no valid fields", 400)

    const { data, error: dbErr } = await supabase
        .from("issues")
        .update(patch)
        .eq("id", id)
        .select("*")
        .single<Issue>()
    if (dbErr) return jsonError("db_error", dbErr.message, 500)
    return Response.json({ issue: data })
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { supabase, error } = await requireUser()
    if (error) return error
    const { error: dbErr } = await supabase.from("issues").delete().eq("id", id)
    if (dbErr) return jsonError("db_error", dbErr.message, 500)
    return new Response(null, { status: 204 })
}
