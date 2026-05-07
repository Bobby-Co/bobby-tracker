import { jsonError, requireUser } from "@/lib/api"
import { findIcon } from "@/lib/iconly"
import type { ProjectLabelIcon } from "@/lib/supabase/types"

// GET /api/projects/[id]/label-icons — full map for this project.
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { supabase, error } = await requireUser()
    if (error) return error
    const { data, error: dbErr } = await supabase
        .from("project_label_icons")
        .select("*")
        .eq("project_id", id)
        .returns<ProjectLabelIcon[]>()
    if (dbErr) return jsonError("db_error", dbErr.message, 500)
    return Response.json({ icons: data ?? [] })
}

// PUT /api/projects/[id]/label-icons — upsert one mapping. Body:
// { label, icon_name, color? }. Validates icon_name against the
// canonical Iconly set so callers can't smuggle arbitrary strings
// the renderer can't draw.
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { supabase, error } = await requireUser()
    if (error) return error

    let body: Record<string, unknown>
    try { body = await request.json() } catch { return jsonError("bad_request", "invalid JSON", 400) }

    const label = typeof body.label === "string" ? body.label.trim() : ""
    const icon_name = typeof body.icon_name === "string" ? body.icon_name.trim() : ""
    if (!label) return jsonError("bad_request", "label required", 400)
    if (!findIcon(icon_name)) return jsonError("bad_request", "unknown icon_name", 400)

    let color: string | null = null
    if ("color" in body) {
        if (body.color === null) color = null
        else if (typeof body.color === "string" && /^#[0-9a-fA-F]{6}$/.test(body.color)) color = body.color
        else return jsonError("bad_request", "color must be #rrggbb or null", 400)
    }

    const { data, error: dbErr } = await supabase
        .from("project_label_icons")
        .upsert({ project_id: id, label, icon_name, color }, { onConflict: "project_id,label" })
        .select("*")
        .single<ProjectLabelIcon>()
    if (dbErr) return jsonError("db_error", dbErr.message, 500)
    return Response.json({ icon: data })
}

// DELETE /api/projects/[id]/label-icons?label=foo — drop one mapping.
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { supabase, error } = await requireUser()
    if (error) return error
    const url = new URL(request.url)
    const label = url.searchParams.get("label")?.trim()
    if (!label) return jsonError("bad_request", "label required", 400)
    const { error: dbErr } = await supabase
        .from("project_label_icons")
        .delete()
        .eq("project_id", id)
        .eq("label", label)
    if (dbErr) return jsonError("db_error", dbErr.message, 500)
    return new Response(null, { status: 204 })
}
