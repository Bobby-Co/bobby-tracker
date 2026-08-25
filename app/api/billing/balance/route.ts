import { ApiContext, jsonError, repoRead } from "@/lib/server/http/api"
import { Balance } from "@/modules/billing"

// GET /api/billing/balance
//
// The lean balance read behind the always-visible sidebar pill: just the active
// team's tier + this period's Prowl Point balance (no breakdown, no recent list).
// Reads the maintained rollup (a single-row lookup), so it's cheap enough to load
// app-wide on every navigation / team switch. The full picture lives at
// GET /api/billing.
export async function GET() {
    const { ctx, teamId, error } = await new ApiContext().requireTeam()
    if (error) return error

    const { data: sub, error: subErr } = await repoRead(() => ctx.subscriptions.findByTeam(teamId))
    if (subErr) return subErr

    const tier = sub?.tier ?? "kit"
    // The window being billed (0088), falling back to the calendar month for a
    // free team. NOT the legacy `period_start` column, which is never advanced —
    // see SpendGate for the difference between the two.
    const periodStart = sub?.current_period_start ?? Balance.currentPeriodStart()

    // Through the billing subject (0076), not the team — see PeriodUsageReader.
    const { data: period, error: usedErr } = await repoRead(() => ctx.periodUsage.forTeam(teamId, periodStart))
    if (usedErr) return usedErr

    const balance = new Balance({
        tier,
        status: sub?.status ?? "active",
        allowanceOverride: sub?.monthly_points ?? null,
        used: period?.points ?? 0,
        periodStart,
    })
    return Response.json({ balance: balance.toJSON() })
}

