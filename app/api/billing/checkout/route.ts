import { ApiContext, forbidden, jsonError, repoRead } from "@/lib/server/http/api"
import { getPaymentGateway, TIER_IDS, Tier, type TierId } from "@/modules/billing"

export const dynamic = "force-dynamic"

// POST /api/billing/checkout  { tier }
//
// Starts a purchase. Returns { url } — Stripe's hosted Checkout page — which the
// client navigates to. It does NOT change the team's plan: a checkout that is
// started and abandoned must leave the team exactly where it was, so the only
// thing that ever grants an entitlement is a webhook saying money moved
// (modules/billing/application/SubscriptionSync.ts).
//
// Admin-gated. Spending the team's money is not something a plain member does.
export async function POST(request: Request) {
    const { ctx, teamId, role, user, error } = await new ApiContext(request).requireTeam()
    if (error) return error
    if (role !== "owner" && role !== "admin") {
        return forbidden("only a team owner or admin can change the plan")
    }

    let tier: string | undefined
    try {
        tier = ((await request.json()) as { tier?: string }).tier
    } catch {
        return jsonError("bad_request", "invalid json body", 400)
    }
    if (!tier || !TIER_IDS.includes(tier as TierId)) {
        return jsonError("bad_request", "a known tier is required", 400)
    }
    const target = tier as TierId

    const gateway = getPaymentGateway()
    if (!gateway.isPurchasable(target)) {
        // Apex, or a tier whose price id is not configured in this environment.
        // Distinguished from a bad request because the client should offer
        // "contact sales" rather than report that it sent something invalid.
        return jsonError(
            "not_purchasable",
            `${Tier.of(target).name} isn't available for self-service checkout — contact sales.`,
            409,
        )
    }

    const { data: sub, error: subErr } = await repoRead(() => ctx.subscriptions.findByTeam(teamId))
    if (subErr) return subErr
    if (sub?.tier === target && sub?.status === "active") {
        return jsonError("already_subscribed", `This team is already on ${Tier.of(target).name}.`, 409)
    }

    const origin = new URL(request.url).origin

    // The return URLs follow the origin the buyer is actually on, which is right —
    // but Stripe's WEBHOOK points at one fixed environment. Check out from
    // localhost while the webhook targets production and the payment succeeds with
    // nobody listening: the customer is charged and entitled to nothing.
    //
    // Recovery handles it now (POST /api/billing/reconcile, and the automatic
    // check on return), but the mismatch is worth saying out loud at the moment it
    // is created rather than leaving it to be discovered later from the symptom.
    const publicUrl = process.env.NEXT_PUBLIC_APP_URL
    if (publicUrl && !publicUrl.startsWith(origin)) {
        console.warn(
            `[billing] checkout starting from ${origin}, but the app is configured as ${publicUrl}. ` +
                "Stripe webhooks go to the configured host — forward them with " +
                "`stripe listen --forward-to " + origin + "/api/webhooks/stripe` or the payment " +
                "will complete with nothing listening here.",
        )
    }
    try {
        // Resume first. A buyer who opened Stripe, thought better of it, and came
        // back should land on the session they left — part-filled card and all —
        // rather than starting over. It is also what stops two completed sessions
        // becoming two subscriptions and two charges.
        if (sub?.stripe_checkout_session_id) {
            const resumable = await gateway.findResumableCheckout(sub.stripe_checkout_session_id, target)
            if (resumable) return Response.json({ url: resumable.url, resumed: true })
        }

        const { url, sessionId } = await gateway.createCheckoutSession({
            teamId,
            tier: target,
            // Reuse the existing customer so a second purchase does not create a
            // duplicate with its own card and its own invoice history.
            customerId: sub?.stripe_customer_id ?? null,
            customerEmail: user?.email ?? null,
            // `checkout=complete` is a HINT to the UI, not proof of anything: the
            // buyer controls this URL. The page it lands on polls our own state,
            // which only the webhook can change.
            successUrl: `${origin}/settings/billing?checkout=complete`,
            cancelUrl: `${origin}/billing/checkout?tier=${target}&canceled=1`,
        })
        // Best-effort: losing this costs a resume, never a purchase, so a write
        // failure must not fail a checkout the buyer is already committed to.
        try {
            await ctx.subscriptions.setCheckoutSession(teamId, sessionId)
        } catch (e) {
            console.warn("[billing] could not record checkout session:", (e as Error).message)
        }
        return Response.json({ url })
    } catch (e) {
        console.error("[billing] checkout session failed:", (e as Error).message)
        return jsonError("checkout_failed", "couldn't start checkout — try again", 502)
    }
}
