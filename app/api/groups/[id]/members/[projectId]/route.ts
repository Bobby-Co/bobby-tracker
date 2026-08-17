import { ApiContext, repoRead } from "@/lib/server/http/api"

// DELETE — remove a project from a group. Owner-only via RLS on the
// membership table; no extra check needed here.
export async function DELETE(_: Request, { params }: { params: Promise<{ id: string; projectId: string }> }) {
    const { id, projectId } = await params
    const { ctx, error } = await new ApiContext().requireCollectionAccess(id, { write: true })
    if (error) return error

    const { error: dbErr } = await repoRead(() => ctx.collections.removeMember(id, projectId))
    if (dbErr) return dbErr
    return new Response(null, { status: 204 })
}
