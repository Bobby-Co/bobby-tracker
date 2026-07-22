import { randomBytes } from "node:crypto"
import { ApiContext, repoRead } from "@/lib/server/http/api"

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { ctx, error } = await new ApiContext().requireSessionAccess(id, { write: true })
    if (error) return error
    const token = randomBytes(24).toString("base64url")
    const { data, error: dbErr } = await repoRead(() => ctx.sessionsAdmin.rotateToken(id, token))
    if (dbErr) return dbErr
    return Response.json({ session: data })
}
