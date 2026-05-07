import { jsonError, requireUser } from "@/lib/api"
import { ISSUE_STATUSES } from "@/lib/supabase/types"
import type { ProjectStatusColor } from "@/lib/supabase/types"

// GET /api/projects/[id]/status-colors — overrides only. Defaults
// live in lib/timeline/colors.ts and are merged client-side.
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { supabase, error } = await requireUser()
    if (error) return error
    const { data, error: dbErr } = await supabase
        .from("project_status_colors")
        .select("*")
        .eq("project_id", id)
        .returns<ProjectStatusColor[]>()
    if (dbErr) return jsonError("db_error", dbErr.message, 500)
    return Response.json({ colors: data ?? [] })
}

// PUT /api/projects/[id]/status-colors — upsert one status entry.
// Body: { status, color }.
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { supabase, error } = await requireUser()
    if (error) return error

    let body: Record<string, unknown>
    try { body = await request.json() } catch { return jsonError("bad_request", "invalid JSON", 400) }

    const status = typeof body.status === "string" ? body.status : ""
    const color = typeof body.color === "string" ? body.color : ""
    if (!(ISSUE_STATUSES as readonly string[]).includes(status))
        return jsonError("bad_request", "invalid status", 400)
    if (!/^#[0-9a-fA-F]{6}$/.test(color))
        return jsonError("bad_request", "color must be #rrggbb", 400)

    const { data, error: dbErr } = await supabase
        .from("project_status_colors")
        .upsert({ project_id: id, status, color }, { onConflict: "project_id,status" })
        .select("*")
        .single<ProjectStatusColor>()
    if (dbErr) return jsonError("db_error", dbErr.message, 500)
    return Response.json({ color: data })
}
