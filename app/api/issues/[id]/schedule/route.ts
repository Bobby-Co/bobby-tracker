import { jsonError, requireUser } from "@/lib/api"
import type { Issue } from "@/lib/supabase/types"

// PATCH /api/issues/[id]/schedule — update timeline placement.
// Accepts any subset of { starts_at, ends_at, lane_y, color }. Pass
// null to unschedule a side (e.g. drag back to the tray sends
// starts_at: null + ends_at: null + lane_y: null). The DB enforces
// ends_at >= starts_at and 0 <= lane_y <= 1.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { supabase, error } = await requireUser()
    if (error) return error

    let body: Record<string, unknown>
    try { body = await request.json() } catch { return jsonError("bad_request", "invalid JSON", 400) }

    const patch: Record<string, unknown> = {}

    if ("starts_at" in body) {
        const v = body.starts_at
        if (v === null) patch.starts_at = null
        else if (typeof v === "string" && !Number.isNaN(Date.parse(v))) patch.starts_at = new Date(v).toISOString()
        else return jsonError("bad_request", "starts_at must be ISO string or null", 400)
    }
    if ("ends_at" in body) {
        const v = body.ends_at
        if (v === null) patch.ends_at = null
        else if (typeof v === "string" && !Number.isNaN(Date.parse(v))) patch.ends_at = new Date(v).toISOString()
        else return jsonError("bad_request", "ends_at must be ISO string or null", 400)
    }
    if ("lane_y" in body) {
        const v = body.lane_y
        if (v === null) patch.lane_y = null
        else if (typeof v === "number" && v >= 0 && v <= 1) patch.lane_y = v
        else return jsonError("bad_request", "lane_y must be 0..1 or null", 400)
    }
    if ("color" in body) {
        const v = body.color
        if (v === null) patch.color = null
        else if (typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v)) patch.color = v
        else return jsonError("bad_request", "color must be #rrggbb or null", 400)
    }

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
