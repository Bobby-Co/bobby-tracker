// Billing infrastructure — the Supabase adapter for UsageRepository (reads). The
// only place that SELECTs the Prowl ledger tables. Bound to the caller's
// RLS-scoped client.
//
// POINTS ARE DERIVED FROM cost_usd HERE, not read from a stored column. The
// analyser records only the raw cost (the truth); Prowl Points are pure billing
// policy (`pointsFromCostUsd`, POINTS_PER_USD), so computing them at read keeps the
// rate in ONE place and immune to migration drift (a stored/generated `points`
// column can silently fall out of sync — e.g. a pre-existing table that a later
// `create table if not exists` never upgraded). Balance reads stay O(1) because
// the cost is pre-aggregated in the rollup; the raw scans below only back the
// low-frequency Usage page.

import type { SupabaseClient } from "@supabase/supabase-js"
import { RepositoryError } from "@/lib/shared/kernel"
import { pointsFromCostUsd } from "../domain/ProwlPoints"
import type { PeriodUsage, UsageByKind, UsageEventRow, UsageRepository } from "../ports/UsageRepository"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any, any, any>

const ROW_COLS = "id, kind, model, cost_usd, input_tokens, output_tokens, project_id, created_at"

export class SupabaseUsageRepository implements UsageRepository {
    constructor(private readonly db: AnyDb) {}

    async currentPeriodUsage(teamId: string, periodStart: string): Promise<PeriodUsage> {
        const { data, error } = await this.db
            .from("prowl_usage_period")
            .select("cost_usd, calls")
            .eq("team_id", teamId)
            .eq("period_start", periodStart)
            .maybeSingle<{ cost_usd: number; calls: number }>()
        if (error) throw new RepositoryError(error.message, { cause: error })
        const costUsd = Number(data?.cost_usd ?? 0)
        return { points: pointsFromCostUsd(costUsd), costUsd, calls: Number(data?.calls ?? 0) }
    }

    async breakdownSince(teamId: string, sinceIso: string): Promise<UsageByKind[]> {
        const { data, error } = await this.db
            .from("prowl_usage_events")
            .select("kind, cost_usd")
            .eq("team_id", teamId)
            .gte("created_at", sinceIso)
        if (error) throw new RepositoryError(error.message, { cause: error })
        // Sum cost per kind, then derive points from the summed cost (fairer than
        // ceil-ing each call, and independent of any stored points column).
        const acc = new Map<string, { kind: string; costUsd: number; calls: number }>()
        for (const r of data ?? []) {
            const cur = acc.get(r.kind) ?? { kind: r.kind, costUsd: 0, calls: 0 }
            cur.costUsd += Number(r.cost_usd ?? 0)
            cur.calls += 1
            acc.set(r.kind, cur)
        }
        return [...acc.values()]
            .map((c) => ({ kind: c.kind, points: pointsFromCostUsd(c.costUsd), calls: c.calls }))
            .sort((a, b) => b.points - a.points)
    }

    async listRecent(teamId: string, limit: number): Promise<UsageEventRow[]> {
        const { data, error } = await this.db
            .from("prowl_usage_events")
            .select(ROW_COLS)
            .eq("team_id", teamId)
            .order("created_at", { ascending: false })
            .limit(limit)
        if (error) throw new RepositoryError(error.message, { cause: error })
        return (data ?? []).map((r) => ({
            id: r.id,
            kind: r.kind,
            model: r.model ?? null,
            points: pointsFromCostUsd(Number(r.cost_usd ?? 0)),
            cost_usd: r.cost_usd ?? null,
            input_tokens: r.input_tokens ?? null,
            output_tokens: r.output_tokens ?? null,
            project_id: r.project_id ?? null,
            created_at: r.created_at,
        }))
    }
}

/** Composition seam: bind a UsageRepository to a specific Supabase client. */
export function createSupabaseUsageRepository(db: AnyDb): UsageRepository {
    return new SupabaseUsageRepository(db)
}
