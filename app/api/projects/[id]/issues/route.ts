import { ApiContext, repoRead } from "@/lib/server/http/api"

// GET /api/projects/[id]/issues — all issues for a project, newest first.
// Mirrors the read previously done server-side by the issues page (and the
// peek-others read on the issue detail page, which is a subset filtered
// client-side). Shape: { issues: Issue[] }.
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { ctx, error } = await new ApiContext().requireProjectAccess(id)
    if (error) return error

    // Safety cap (1000) — realistic projects are far under this; prevents a
    // pathological project from shipping a huge payload in one Worker request.
    const { data: issues, error: dbErr } = await repoRead(() => ctx.issues.listForProject(id, 1000))
    if (dbErr) return dbErr
    return Response.json({ issues })
}
