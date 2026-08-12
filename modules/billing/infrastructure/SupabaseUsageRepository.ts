// Billing infrastructure — the Supabase adapter for UsageRepository (reads). The
// only place that SELECTs tracker.prowl_usage_events. Bound to the caller's
// RLS-scoped client. Aggregations are done in-adapter (small per-team windows);
// if a team's monthly volume ever outgrows that, these two become a SQL view / RPC
// without touching the port or its callers.

import type { SupabaseClient } from "@supabase/supabase-js"
import { RepositoryError } from "@/lib/shared/kernel"
import type { UsageByKind, UsageEventRow, UsageRepository } from "../ports/UsageRepository"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any, any, any>

const ROW_COLS = "id, kind, model, points, cost_usd, input_tokens, output_tokens, project_id, created_at"

export class SupabaseUsageRepository implements UsageRepository {
    constructor(private readonly db: AnyDb) {}

    async sumPointsSince(teamId: string, sinceIso: string): Promise<number> {
        const { data, error } = await this.db
            .from("prowl_usage_events")
            .select("points")
            .eq("team_id", teamId)
            .gte("created_at", sinceIso)
        if (error) throw new RepositoryError(error.message, { cause: error })
        return (data ?? []).reduce((sum, r) => sum + (r.points ?? 0), 0)
    }

    async breakdownSince(teamId: string, sinceIso: string): Promise<UsageByKind[]> {
        const { data, error } = await this.db
            .from("prowl_usage_events")
            .select("kind, points")
            .eq("team_id", teamId)
            .gte("created_at", sinceIso)
        if (error) throw new RepositoryError(error.message, { cause: error })
        const acc = new Map<string, UsageByKind>()
        for (const r of data ?? []) {
            const cur = acc.get(r.kind) ?? { kind: r.kind, points: 0, calls: 0 }
            cur.points += r.points ?? 0
            cur.calls += 1
            acc.set(r.kind, cur)
        }
        return [...acc.values()].sort((a, b) => b.points - a.points)
    }

    async listRecent(teamId: string, limit: number): Promise<UsageEventRow[]> {
        const { data, error } = await this.db
            .from("prowl_usage_events")
            .select(ROW_COLS)
            .eq("team_id", teamId)
            .order("created_at", { ascending: false })
            .limit(limit)
        if (error) throw new RepositoryError(error.message, { cause: error })
        return (data ?? []) as UsageEventRow[]
    }
}

/** Composition seam: bind a UsageRepository to a specific Supabase client. */
export function createSupabaseUsageRepository(db: AnyDb): UsageRepository {
    return new SupabaseUsageRepository(db)
}
