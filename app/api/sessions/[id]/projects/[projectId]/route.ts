import { ApiContext, repoRead } from "@/lib/server/http/api"

export async function DELETE(
    _: Request,
    { params }: { params: Promise<{ id: string; projectId: string }> },
) {
    const { id, projectId } = await params
    const { ctx, error } = await new ApiContext().requireSessionAccess(id, { write: true })
    if (error) return error
    const { error: dbErr } = await repoRead(() => ctx.sessionsAdmin.removeProject(id, projectId))
    if (dbErr) return dbErr
    return new Response(null, { status: 204 })
}
