import { ApiContext, jsonError, repoRead } from "@/lib/server/http/api"
import { Balance, Tier, TIER_IDS } from "@/modules/billing"

// GET /api/billing
//
// The Prowl billing summary for the ACTIVE team (x-team-id header → cookie): its
// tier, this period's Prowl Point balance (allowance − spend), a per-kind usage
// breakdown, the most recent calls, and the full tier ladder for the pricing
// table. Any team member may read it; there is nothing here a member can't see
// about their own team's spend.
//
// The number that drives the meter — points used this period — is summed from the
// append-only usage ledger, so it reflects exactly what the metering layer has
// recorded (zero until the first billable model call lands).
export async function GET() {
    const { ctx, teamId, role, error } = await new ApiContext().requireTeam()
    if (error) return error

    const { data: sub, error: subErr } = await repoRead(() => ctx.subscriptions.findByTeam(teamId))
    if (subErr) return subErr

    // A team with no subscription row (created before the provisioning trigger, or
    // an in-flight backfill) is treated as Kit — the safe free-tier floor — with a
    // period anchored to the current month.
    const tier = sub?.tier ?? "kit"
    // The window being billed (0088), falling back to the calendar month for a
    // free team. NOT the legacy `period_start` column, which is never advanced —
    // see SpendGate for the difference between the two.
    const periodStart = sub?.current_period_start ?? Balance.currentPeriodStart()

    // Balance comes from the maintained rollup (single-row lookups), not a scan of
    // the event log — so it stays O(1) however much usage a team accrues.
    //
    // Read against the team's BILLING IDENTITY rather than the team itself (0076):
    // the balance is the subject's, summed across every team it has ever been
    // bound to, so a team that replaced a deleted one continues its predecessor's
    // period instead of starting fresh. A team with no subject yet — one created
    // before 0076, before the lazy backfill on the create path has reached it —
    // falls back to its own rollup row, which is exactly what it used to read.
    const { data: period, error: usedErr } = await repoRead(() => ctx.periodUsage.forTeam(teamId, periodStart))
    if (usedErr) return usedErr

    const { data: subject } = await repoRead(() => ctx.usageSubjects.findForTeam(teamId))

    const { data: breakdown, error: bdErr } = await repoRead(() => ctx.usage.breakdownSince(teamId, periodStart))
    if (bdErr) return bdErr

    const { data: recent, error: recErr } = await repoRead(() => ctx.usage.listRecent(teamId, 12))
    if (recErr) return recErr

    const balance = new Balance({
        tier,
        status: sub?.status ?? "active",
        allowanceOverride: sub?.monthly_points ?? null,
        used: period?.points ?? 0,
        periodStart,
    })

    return Response.json({
        role,
        status: sub?.status ?? "active",
        // Suspended means: data kept, nothing may be spent, and the team's free
        // slot is released for another team (0076). The UI reads this to show the
        // paused state and the resume control.
        suspended: subject?.status === "suspended" || sub?.status === "suspended",
        slot: subject?.slot ?? null,
        // Whether this team has ever checked out. Drives which control the plan
        // ladder offers: a team with a Stripe customer changes plans through the
        // billing portal (where Stripe handles proration and cancellation), a
        // team without one goes through checkout to create a subscription.
        hasBillingAccount: !!sub?.stripe_customer_id,
        currentPeriodStart: sub?.current_period_start ?? null,
        currentPeriodEnd: sub?.current_period_end ?? null,
        cancelAtPeriodEnd: sub?.cancel_at_period_end ?? false,
        balance: balance.toJSON(),
        breakdown,
        recent,
        // The catalogue the pricing table renders — server-owned so copy/prices
        // live in one place (modules/billing Tier).
        tiers: TIER_IDS.map((id) => Tier.of(id).spec),
    })
}

