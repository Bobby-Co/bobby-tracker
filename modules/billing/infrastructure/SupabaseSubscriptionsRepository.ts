// Billing infrastructure — the Supabase adapter for SubscriptionsRepository. The
// only place that queries tracker.team_subscriptions. Bound to the caller's
// RLS-scoped client, so every read/write is DB-scoped to their teams.

import type { SupabaseClient } from "@supabase/supabase-js"
import { RepositoryError } from "@/lib/shared/kernel"
import type { TierId } from "../domain/Tier"
import type { SubscriptionRow, SubscriptionsRepository } from "../ports/SubscriptionsRepository"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any, any, any>

const COLS = "team_id, tier, monthly_points, period_start, status"

export class SupabaseSubscriptionsRepository implements SubscriptionsRepository {
    constructor(private readonly db: AnyDb) {}

    async findByTeam(teamId: string): Promise<SubscriptionRow | null> {
        const { data, error } = await this.db
            .from("team_subscriptions")
            .select(COLS)
            .eq("team_id", teamId)
            .maybeSingle<SubscriptionRow>()
        if (error) throw new RepositoryError(error.message, { cause: error })
        return data ?? null
    }

    async setStatus(teamId: string, status: SubscriptionRow["status"]): Promise<void> {
        const { error } = await this.db.from("team_subscriptions").update({ status }).eq("team_id", teamId)
        if (error) throw new RepositoryError(error.message, { cause: error })
    }

    async setTier(teamId: string, tier: TierId): Promise<SubscriptionRow> {
        const { data, error } = await this.db
            .from("team_subscriptions")
            .update({ tier })
            .eq("team_id", teamId)
            .select(COLS)
            .single<SubscriptionRow>()
        if (error) throw new RepositoryError(error.message, { cause: error })
        return data
    }
}

/** Composition seam: bind a SubscriptionsRepository to a specific Supabase client. */
export function createSupabaseSubscriptionsRepository(db: AnyDb): SubscriptionsRepository {
    return new SupabaseSubscriptionsRepository(db)
}
