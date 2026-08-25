import { ApiContext, forbidden, jsonError, repoRead } from "@/lib/server/http/api"
import { getPaymentGateway } from "@/modules/billing"

export const dynamic = "force-dynamic"

// POST /api/billing/portal
//
// A session for Stripe's billing portal: update the card, cancel, download past
// invoices from the source. Deliberately not rebuilt in-app — card management and
// cancellation flows are a large surface with real regulatory weight (SCA, refund
// rules), and Stripe maintains it.
//
// A team that has never checked out has no customer, so there is nothing to
// manage; that is a 409 rather than an error, and the UI hides the button.
export async function POST(request: Request) {
    const { ctx, teamId, role, error } = await new ApiContext(request).requireTeam()
    if (error) return error
    if (role !== "owner" && role !== "admin") {
        return forbidden("only a team owner or admin can manage billing")
    }

    const { data: sub, error: subErr } = await repoRead(() => ctx.subscriptions.findByTeam(teamId))
    if (subErr) return subErr
    if (!sub?.stripe_customer_id) {
        return jsonError("no_customer", "this team has no billing account yet", 409)
    }

    const origin = new URL(request.url).origin
    try {
        const { url } = await getPaymentGateway().createPortalSession(
            sub.stripe_customer_id,
            `${origin}/settings/billing`,
        )
        return Response.json({ url })
    } catch (e) {
        console.error("[billing] portal session failed:", (e as Error).message)
        return jsonError("portal_failed", "couldn't open the billing portal — try again", 502)
    }
}
