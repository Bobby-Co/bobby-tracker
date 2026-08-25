import { ApiContext, repoRead } from "@/lib/server/http/api"

export const dynamic = "force-dynamic"

// GET /api/billing/invoices — the active team's invoice history, newest first.
//
// Read from OUR mirror rather than from Stripe. Two reasons: the page renders
// without a round trip to a third party (and still renders when that third party
// is down), and the rows are ours to join and filter. The hosted URL and PDF link
// still point at Stripe, which remains the authority on what was actually charged.
//
// Any member may read it. A team's own spend is not privileged information within
// the team — the same rule GET /api/billing already applies.
export async function GET(request: Request) {
    const { ctx, teamId, error } = await new ApiContext(request).requireTeam()
    if (error) return error

    const { data, error: readErr } = await repoRead(() => ctx.invoices.listForTeam(teamId, 24))
    if (readErr) return readErr

    return Response.json({ invoices: data ?? [] })
}
