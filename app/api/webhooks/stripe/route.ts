import { getPaymentGateway, getSubscriptionSync } from "@/modules/billing"

export const dynamic = "force-dynamic"

// POST /api/webhooks/stripe — the only thing that can change a team's plan.
//
// ─── Why this endpoint, and not the checkout route, grants entitlements ─────
//
// A buyer controls their own browser: they can be redirected to the success URL
// without having paid, close the tab after paying, or have a card that needs 3DS
// and settles minutes later. None of that is visible from our side of the
// redirect. Stripe telling us, server to server, that money moved is the only
// signal that means anything — so the checkout route creates a session and
// changes nothing, and every entitlement change in the system starts here.
//
// ─── The raw body matters ───────────────────────────────────────────────────
//
// The signature is over the EXACT bytes Stripe sent. `request.text()` before any
// parsing is deliberate: `request.json()` would reformat the payload and every
// signature would fail. There is no body-parser to disable in the App Router, but
// the ordering constraint is the same one that trips people on Express.
//
// ─── What the status codes mean to Stripe ───────────────────────────────────
//
// Stripe retries anything that is not 2xx, with backoff, for about three days.
// So the codes here are a queue protocol, not decoration:
//
//   400  bad signature — never retry, this is not us. Also the one case that
//        must never be treated as a transient failure: an attacker POSTing
//        forged upgrade events would love us to "retry until it works".
//   200  applied, or an event type we do not act on. Do not send it again.
//   409  we cannot attribute this event YET (an invoice that overtook the
//        subscription that explains it). Please send it again shortly.
//   500  our fault — the database was unreachable. Please send it again.
export async function POST(request: Request) {
    const signature = request.headers.get("stripe-signature")
    if (!signature) return json({ error: "missing signature" }, 400)

    const payload = await request.text()

    let event
    try {
        event = await getPaymentGateway().readEvent(payload, signature)
    } catch (e) {
        // Includes a missing STRIPE_WEBHOOK_SECRET, which is deliberately NOT a
        // 503: an unconfigured verifier cannot tell a real event from a forged
        // one, so the only safe answer is to reject.
        console.warn("[stripe] rejected webhook:", (e as Error).message)
        return json({ error: "invalid signature" }, 400)
    }

    try {
        const outcome = await getSubscriptionSync().apply(event)
        if (outcome.applied) {
            console.info(`[stripe] ${outcome.what} for team ${outcome.teamId}`)
            return json({ ok: true })
        }
        if (outcome.retryable) {
            console.warn(`[stripe] deferring: ${outcome.reason}`)
            return json({ ok: false, reason: outcome.reason }, 409)
        }
        return json({ ok: true, skipped: outcome.reason })
    } catch (e) {
        console.error("[stripe] failed to apply webhook:", (e as Error).message)
        return json({ error: "apply failed" }, 500)
    }
}

function json(body: unknown, status = 200) {
    return Response.json(body, { status })
}
