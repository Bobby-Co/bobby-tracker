import { ApiContext, jsonError, repoRead } from "@/lib/server/http/api"
import { ISSUE_STATUSES } from "@/lib/shared/types"

// GET /api/projects/[id]/status-colors — overrides only. Defaults
// live in lib/timeline/colors.ts and are merged client-side.
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { ctx, error } = await new ApiContext().requireProjectAccess(id)
    if (error) return error
    const { data: colors, error: dbErr } = await repoRead(() => ctx.projectDisplay.listStatusColors(id))
    if (dbErr) return dbErr
    return Response.json({ colors })
}

// PUT /api/projects/[id]/status-colors — upsert one status entry.
// Body: { status, color }.
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { ctx, error } = await new ApiContext().requireProjectAccess(id)
    if (error) return error

    let body: Record<string, unknown>
    try { body = await request.json() } catch { return jsonError("bad_request", "invalid JSON", 400) }

    const status = typeof body.status === "string" ? body.status : ""
    const color = typeof body.color === "string" ? body.color : ""
    if (!(ISSUE_STATUSES as readonly string[]).includes(status))
        return jsonError("bad_request", "invalid status", 400)
    if (!/^#[0-9a-fA-F]{6}$/.test(color))
        return jsonError("bad_request", "color must be #rrggbb", 400)

    const { data, error: dbErr } = await repoRead(() => ctx.projectDisplay.upsertStatusColor(id, status, color))
    if (dbErr) return dbErr
    return Response.json({ color: data })
}
