import { ApiContext, repoRead } from "@/lib/server/http/api"

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { ctx, error } = await new ApiContext().requireProjectAccess(id)
    if (error) return error

    const { data, error: dbErr } = await repoRead(() =>
        ctx.analyser.findByProjectId(id),
    )
    if (dbErr) return dbErr
    return Response.json({ analyser: data })
}