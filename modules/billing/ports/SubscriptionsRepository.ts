// Billing module — the team_subscriptions persistence PORT. Owns the one
// subscription row per team (tier + optional negotiated allowance + period). RLS
// scopes reads to the caller's teams; the tier mutation is admin-gated at the DB
// and re-checked in the route.

import type { TierId } from "../domain/Tier"

/** A team's subscription row. `monthly_points` is a negotiated override — null
 *  means "use the tier's catalogue default" (see Balance). */
export interface SubscriptionRow {
    team_id: string
    tier: TierId
    monthly_points: number | null
    period_start: string
    status: "active" | "past_due" | "canceled" | "suspended"
}

export interface SubscriptionsRepository {
    /** The team's subscription, or null when absent (a team created before its
     *  provisioning trigger ran, or an unknown team). THROWS RepositoryError on a
     *  genuine query failure. */
    findByTeam(teamId: string): Promise<SubscriptionRow | null>

    /** Pause or resume a team's subscription (0076). 'suspended' means the team
     *  is kept but may not spend, and its free slot is released — the mirror of
     *  usage_subjects.status, kept in step so the two billing surfaces never
     *  disagree. THROWS RepositoryError on failure. */
    setStatus(teamId: string, status: SubscriptionRow["status"]): Promise<void>

    /** Change a team's tier and return the updated row. Admin-gated by RLS; the
     *  route re-checks the role. THROWS RepositoryError on failure. */
    setTier(teamId: string, tier: TierId): Promise<SubscriptionRow>
}
