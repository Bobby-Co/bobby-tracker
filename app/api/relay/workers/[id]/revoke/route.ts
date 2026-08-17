import { ApiContext, repoRead } from "@/lib/server/http/api"

// AUTH. Revoke a worker by stamping revoked_at. RLS scopes the update to
// the owner. Revoked rows stop resolving in /api/relay/resolve, so the
// worker's token is immediately dead — revoke is real, not cosmetic.
export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { ctx, error } = await new ApiContext().requireUser()
    if (error) return error

    const { error: dbErr } = await repoRead(() => ctx.relayWorkers.revoke(id))
    if (dbErr) return dbErr

    return Response.json({ ok: true })
}
