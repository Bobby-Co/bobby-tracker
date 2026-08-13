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
    const periodStart = sub?.period_start ?? startOfMonthUtc()

    // Balance comes from the maintained rollup (single-row lookup), not a scan of
    // the event log — so it stays O(1) however much usage a team accrues.
    const { data: period, error: usedErr } = await repoRead(() => ctx.usage.currentPeriodUsage(teamId, periodStart))
    if (usedErr) return usedErr

    const { data: breakdown, error: bdErr } = await repoRead(() => ctx.usage.breakdownSince(teamId, periodStart))
    if (bdErr) return bdErr

    const { data: recent, error: recErr } = await repoRead(() => ctx.usage.listRecent(teamId, 12))
    if (recErr) return recErr

    const balance = new Balance({
        tier,
        allowanceOverride: sub?.monthly_points ?? null,
        used: period?.points ?? 0,
        periodStart,
    })

    return Response.json({
        role,
        status: sub?.status ?? "active",
        balance: balance.toJSON(),
        breakdown,
        recent,
        // The catalogue the pricing table renders — server-owned so copy/prices
        // live in one place (modules/billing Tier).
        tiers: TIER_IDS.map((id) => Tier.of(id).spec),
    })
}

function startOfMonthUtc(): string {
    const now = new Date()
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
}
