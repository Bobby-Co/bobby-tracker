import { ApiContext } from "@/lib/server/http/api"

// GET /api/projects/[id]/sessions — backs the Integrations tab: the
// project's public-submissions integration row plus the public sessions
// that cover it. Both queries can fail independently when the public-*
// migrations haven't landed; we tolerate that with a `tableMissing`
// flag so the UI can show a single "pending migration" banner instead
// of erroring outright.
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { ctx, error } = await new ApiContext().requireProjectAccess(id)
    if (error) return error

    const { integration, sessions, tableMissing } = await ctx.publicIntegration.findIntegrationTab(id)
    return Response.json({ integration, sessions, tableMissing })
}
