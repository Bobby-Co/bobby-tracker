import { ApiContext, jsonError, repoRead } from "@/lib/server/http/api"
import { findIcon } from "@/lib/shared/icons/iconly"
import { ICONLY_NAMES } from "@/lib/shared/icons/iconly-catalog"

function isKnownIconName(name: string): boolean {
    return ICONLY_NAMES.has(name) || !!findIcon(name)
}

// GET /api/projects/[id]/label-icons — full map for this project.
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { ctx, error } = await new ApiContext().requireProjectAccess(id)
    if (error) return error
    const { data: icons, error: dbErr } = await repoRead(() => ctx.projectDisplay.listLabelIcons(id))
    if (dbErr) return dbErr
    return Response.json({ icons })
}

// PUT /api/projects/[id]/label-icons — upsert one mapping. Body:
// { label, icon_name, color? }. Validates icon_name against the
// canonical Iconly set so callers can't smuggle arbitrary strings
// the renderer can't draw.
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { ctx, error } = await new ApiContext().requireProjectAccess(id)
    if (error) return error

    let body: Record<string, unknown>
    try { body = await request.json() } catch { return jsonError("bad_request", "invalid JSON", 400) }

    const label = typeof body.label === "string" ? body.label.trim() : ""
    const icon_name = typeof body.icon_name === "string" ? body.icon_name.trim() : ""
    if (!label) return jsonError("bad_request", "label required", 400)
    if (!isKnownIconName(icon_name)) return jsonError("bad_request", "unknown icon_name", 400)

    let color: string | null = null
    if ("color" in body) {
        if (body.color === null) color = null
        else if (typeof body.color === "string" && /^#[0-9a-fA-F]{6}$/.test(body.color)) color = body.color
        else return jsonError("bad_request", "color must be #rrggbb or null", 400)
    }

    const { data, error: dbErr } = await repoRead(() => ctx.projectDisplay.upsertLabelIcon(id, label, icon_name, color))
    if (dbErr) return dbErr
    return Response.json({ icon: data })
}

// DELETE /api/projects/[id]/label-icons?label=foo — drop one mapping.
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { ctx, error } = await new ApiContext().requireProjectAccess(id)
    if (error) return error
    const url = new URL(request.url)
    const label = url.searchParams.get("label")?.trim()
    if (!label) return jsonError("bad_request", "label required", 400)
    const { error: dbErr } = await repoRead(() => ctx.projectDisplay.deleteLabelIcon(id, label))
    if (dbErr) return dbErr
    return new Response(null, { status: 204 })
}
