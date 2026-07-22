import { ApiContext, jsonError, repoRead } from "@/lib/server/http/api"
import type { CollectionPatch } from "@/modules/teams"

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { ctx, error } = await new ApiContext().requireUser()
    if (error) return error
    const { data: group, error: dbErr } = await repoRead(() => ctx.collections.findById(id))
    if (dbErr) return dbErr
    if (!group) return jsonError("not_found", "group not found", 404)

    // Hydrate members with project name + whether the project has a
    // summary embedding yet (drives the routing UI's "needs index"
    // hint per row).
    const members = (await ctx.collections.listMembers(id))
        .map((m) => ({ id: m.id, name: m.name, has_summary: m.has_summary }))
        .sort((a, b) => a.name.localeCompare(b.name))

    // Full project list (id+name, alphabetical) for the settings
    // panel's "add member" picker.
    const allProjects = await ctx.projects.listAllNames()

    return Response.json({ group, members, allProjects })
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { ctx, error } = await new ApiContext().requireCollectionAccess(id, { write: true })
    if (error) return error

    let body: Record<string, unknown>
    try { body = await request.json() } catch { return jsonError("bad_request", "invalid JSON", 400) }

    const patch: CollectionPatch = {}
    if (typeof body.name === "string") {
        const v = body.name.trim()
        if (!v) return jsonError("bad_request", "name cannot be empty", 400)
        patch.name = v
    }
    if (typeof body.description === "string") patch.description = body.description.trim() || null
    if (Object.keys(patch).length === 0) return jsonError("bad_request", "no fields to update", 400)

    const { data, error: dbErr } = await repoRead(() => ctx.collections.update(id, patch))
    if (dbErr) return dbErr
    return Response.json({ group: data })
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { ctx, error } = await new ApiContext().requireCollectionAccess(id, { write: true })
    if (error) return error
    const { error: dbErr } = await repoRead(() => ctx.collections.delete(id))
    if (dbErr) return dbErr
    return new Response(null, { status: 204 })
}
