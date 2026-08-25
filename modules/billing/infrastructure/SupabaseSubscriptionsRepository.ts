// Billing infrastructure — the Supabase adapter for SubscriptionsRepository. The
// only place that queries tracker.team_subscriptions. Bound to the caller's
// RLS-scoped client, so every read/write is DB-scoped to their teams.

import type { SupabaseClient } from "@supabase/supabase-js"
import { RepositoryError } from "@/lib/shared/kernel"
import type { TierId } from "../domain/Tier"
import type { SubscriptionPatch, SubscriptionRow, SubscriptionsRepository } from "../ports/SubscriptionsRepository"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any, any, any>

const COLS =
    "team_id, tier, monthly_points, period_start, status, stripe_customer_id, " +
    "stripe_subscription_id, stripe_checkout_session_id, current_period_start, " +
    "current_period_end, cancel_at_period_end"

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

    async findByStripeSubscription(subscriptionId: string): Promise<SubscriptionRow | null> {
        const { data, error } = await this.db
            .from("team_subscriptions")
            .select(COLS)
            .eq("stripe_subscription_id", subscriptionId)
            .maybeSingle<SubscriptionRow>()
        if (error) throw new RepositoryError(error.message, { cause: error })
        return data ?? null
    }

    async findByStripeCustomer(customerId: string): Promise<SubscriptionRow | null> {
        const { data, error } = await this.db
            .from("team_subscriptions")
            .select(COLS)
            .eq("stripe_customer_id", customerId)
            .maybeSingle<SubscriptionRow>()
        if (error) throw new RepositoryError(error.message, { cause: error })
        return data ?? null
    }

    async setCheckoutSession(teamId: string, sessionId: string | null): Promise<void> {
        const { error } = await this.db
            .from("team_subscriptions")
            .update({ stripe_checkout_session_id: sessionId })
            .eq("team_id", teamId)
        if (error) throw new RepositoryError(error.message, { cause: error })
    }

    async applySubscription(teamId: string, patch: SubscriptionPatch): Promise<void> {
        // Only the keys the event actually carried. Spreading an object with
        // undefined values would send explicit nulls to PostgREST and blank
        // columns the event said nothing about — the customer id, most damagingly,
        // which is how a team would lose its link to Stripe on a routine update.
        const update: Record<string, unknown> = { status: patch.status }
        if (patch.tier !== undefined) update.tier = patch.tier
        if (patch.stripe_customer_id !== undefined) update.stripe_customer_id = patch.stripe_customer_id
        if (patch.stripe_subscription_id !== undefined) {
            update.stripe_subscription_id = patch.stripe_subscription_id
        }
        if (patch.current_period_start !== undefined) {
            update.current_period_start = patch.current_period_start
        }
        if (patch.current_period_end !== undefined) update.current_period_end = patch.current_period_end
        if (patch.cancel_at_period_end !== undefined) {
            update.cancel_at_period_end = patch.cancel_at_period_end
        }

        const { error } = await this.db.from("team_subscriptions").update(update).eq("team_id", teamId)
        if (error) throw new RepositoryError(error.message, { cause: error })
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
