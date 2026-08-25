import { ApiContext, forbidden, jsonError, repoRead } from "@/lib/server/http/api"
import {
    Balance,
    getPaymentGateway,
    quoteUpgrade,
    TIER_IDS,
    Tier,
    type TierId,
} from "@/modules/billing"

export const dynamic = "force-dynamic"

// POST /api/billing/upgrade  { tier }   → moves an EXISTING subscription
// GET  /api/billing/upgrade?tier=…      → quotes it without charging anything
//
// Separate from /checkout because the two are different transactions. Checkout
// creates a subscription and takes a card; this moves a subscription that already
// has one, and prices it against the credits the team has not spent.
//
// ─── The quote is computed server-side, twice ────────────────────────────────
//
// GET renders the number and POST recomputes it before charging. The client is
// never trusted with the discount — a POST body carrying "discountCents" would be
// a free-money endpoint. Recomputing also means the quote reflects credits spent
// between the page rendering and the button being pressed, which on a busy team
// is a real interval.
export async function GET(request: Request) {
    const quoted = await quote(request)
    if ("error" in quoted) return quoted.error
    return Response.json({ quote: quoted.quote, from: quoted.from, to: quoted.to })
}

export async function POST(request: Request) {
    let tier: string | undefined
    try {
        tier = ((await request.json()) as { tier?: string }).tier
    } catch {
        return jsonError("bad_request", "invalid json body", 400)
    }

    const quoted = await quote(request, tier)
    if ("error" in quoted) return quoted.error
    const { sub, target, quote: q } = quoted

    try {
        await getPaymentGateway().changePlan({
            subscriptionId: sub.stripe_subscription_id as string,
            customerId: sub.stripe_customer_id as string,
            tier: target,
            discountCents: q.discountCents,
        })
    } catch (e) {
        console.error("[billing] plan change failed:", (e as Error).message)
        return jsonError("upgrade_failed", "couldn't change the plan — try again", 502)
    }

    // The tier is NOT written here. Stripe's subscription.updated webhook is what
    // changes entitlement, exactly as it is for a first purchase — so there is one
    // path by which a plan can change and one place it can go wrong.
    return Response.json({ ok: true, quote: q })
}

type Quoted =
    | { error: Response }
    | {
          error?: never
          sub: { stripe_subscription_id: string | null; stripe_customer_id: string | null }
          target: TierId
          from: string
          to: string
          quote: ReturnType<typeof quoteUpgrade>
      }

async function quote(request: Request, bodyTier?: string): Promise<Quoted> {
    const { ctx, teamId, role, error } = await new ApiContext(request).requireTeam()
    if (error) return { error }
    if (role !== "owner" && role !== "admin") {
        return { error: forbidden("only a team owner or admin can change the plan") }
    }

    const tier = bodyTier ?? new URL(request.url).searchParams.get("tier") ?? undefined
    if (!tier || !TIER_IDS.includes(tier as TierId)) {
        return { error: jsonError("bad_request", "a known tier is required", 400) }
    }
    const target = tier as TierId

    if (!getPaymentGateway().isPurchasable(target)) {
        return {
            error: jsonError(
                "not_purchasable",
                `${Tier.of(target).name} isn't available for self-service — contact sales.`,
                409,
            ),
        }
    }

    const { data: sub, error: subErr } = await repoRead(() => ctx.subscriptions.findByTeam(teamId))
    if (subErr) return { error: subErr }
    if (!sub?.stripe_subscription_id || !sub.stripe_customer_id) {
        // No subscription to move — this team should be going through checkout.
        return { error: jsonError("no_subscription", "this team has no subscription to change", 409) }
    }
    if (sub.tier === target) {
        return { error: jsonError("already_subscribed", `Already on ${Tier.of(target).name}.`, 409) }
    }

    // Credits REMAINING, over the window currently being billed. Remaining is
    // already floored at zero by Balance, so a team that overspent quotes at full
    // price rather than being charged extra.
    const periodStart = sub.current_period_start ?? Balance.currentPeriodStart()
    const { data: period, error: usedErr } = await repoRead(() =>
        ctx.periodUsage.forTeam(teamId, periodStart),
    )
    if (usedErr) return { error: usedErr }

    const balance = new Balance({
        tier: sub.tier,
        status: sub.status,
        allowanceOverride: sub.monthly_points ?? null,
        used: period?.points ?? 0,
        periodStart,
    })

    return {
        sub,
        target,
        from: sub.tier,
        to: target,
        // The plan being LEFT is what prices the refund — see domain/UpgradeCredit.
        quote: quoteUpgrade(target, balance.remaining ?? 0, sub.tier),
    }
}
