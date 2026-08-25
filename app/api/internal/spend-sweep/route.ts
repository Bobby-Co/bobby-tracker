import { jsonError } from "@/lib/server/http/api"
import { createExhaustionSweep } from "@/modules/analysis"
import { createSupabaseTeamsRepository } from "@/modules/teams"
import { dataClientForCell } from "@/lib/server/regional"
import { Supabase } from "@/lib/server/supabase"

export const dynamic = "force-dynamic"

// POST /api/internal/spend-sweep — the DB→app callback fired by the
// tracker.prowl_sweep_on_usage trigger (migration 0084) whenever a team's usage
// rollup moves. Server-to-server, authenticated with the shared SPEND_SWEEP_TOKEN,
// which must equal tracker.app_config.spend_sweep_token.
//
// WHY A TRIGGER AND NOT A CHECK IN THE APP. The spend that crosses a team's
// allowance is recorded by the ANALYSER, mid-run, straight into the ledger — the
// tracker is not in that loop and has no other way to learn about it. There is
// also no scheduler in this stack to poll with (no cron, no pg_cron, no OpenNext
// scheduled handler), so the write itself has to be what wakes us. Same mechanism
// as the notification-email callback (0051).
//
// Body is just { team_id }; the balance is re-read here so the decision is made
// on committed state, and so the rule for "may not spend" stays in one place
// (SpendGate) rather than being duplicated in SQL, which would need the tier
// ladder — deliberately config, not schema — copied into the database.
//
// The trigger fires on every rollup write, which is far more often than a team
// actually crosses a line. That is intentional: the no-op path is one balance
// read and a 200, and making the DATABASE decide who is exhausted is what we are
// avoiding. pg_net is fire-and-forget, so the response is only for logs.
export async function POST(request: Request) {
    const expected = process.env.SPEND_SWEEP_TOKEN
    if (!expected) return jsonError("not_configured", "spend sweep callback is not configured", 503)

    const auth = request.headers.get("authorization") ?? ""
    const presented = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : ""
    if (presented !== expected) return jsonError("unauthorized", "bad sweep token", 401)

    let teamId: string | undefined
    try {
        const body = (await request.json()) as { team_id?: string }
        teamId = body.team_id
    } catch {
        return jsonError("bad_request", "invalid json body", 400)
    }
    if (!teamId) return jsonError("bad_request", "team_id is required", 400)

    try {
        // The runs to cancel are REGIONAL, so the sweep has to be bound to the
        // team's own cell (0064). A team with no readable cell is not swept —
        // cancelling against the wrong analyser would be a no-op that reported
        // success, which is worse than reporting that we could not do it.
        const cell = await createSupabaseTeamsRepository(Supabase.service()).findCell(teamId)
        if (!cell) return jsonError("no_cell", "team has no readable cell", 409)

        const result = await createExhaustionSweep(dataClientForCell(cell)).sweep(teamId)
        if (result.reason) {
            console.warn(
                `[spend-sweep] team ${teamId} (${result.reason}): cancelled ${result.cancelled} run(s), ` +
                    `${result.failed} failed`,
            )
        }
        return Response.json({ ok: true, ...result })
    } catch (err) {
        const e = err as { message?: string }
        console.error("[spend-sweep] failed:", e?.message)
        return jsonError("sweep_failed", e?.message ?? "sweep failed", 500)
    }
}
