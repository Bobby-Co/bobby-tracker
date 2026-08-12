// Billing bounded context — PUBLIC CONTRACT (see modules/README.md). "Prowl" is
// Ucelot's usage-metering & credits system: every model call spends Prowl Points
// drawn from a team's monthly, tier-based allowance. Import only from here.

// ─── domain: the tier ladder, the currency, the per-period balance ───────────
export { Tier, TIER_IDS } from "./domain/Tier"
export type { TierId, TierSpec } from "./domain/Tier"
export { Balance } from "./domain/Balance"
export type { BalanceInput } from "./domain/Balance"
export {
    POINTS_PER_USD,
    POINTS_PER_1K_TOKENS,
    pointsForUsage,
    pointsFromCostUsd,
    pointsFromTokens,
    formatPoints,
} from "./domain/ProwlPoints"
export type { UsageSignal } from "./domain/ProwlPoints"

// ─── subscriptions (team_subscriptions) ──────────────────────────────────────
export type { SubscriptionsRepository, SubscriptionRow } from "./ports/SubscriptionsRepository"
export { createSupabaseSubscriptionsRepository } from "./infrastructure/SupabaseSubscriptionsRepository"

// ─── usage ledger reads (prowl_usage_events) ─────────────────────────────────
export type { UsageRepository, UsageEventRow, UsageByKind } from "./ports/UsageRepository"
export { createSupabaseUsageRepository } from "./infrastructure/SupabaseUsageRepository"

// ─── usage writes + the billing subject ──────────────────────────────────────
export type { UsageRecorder, UsageEventInput, BillingSubject } from "./ports/UsageRecorder"
export { createServiceUsageRecorder } from "./infrastructure/ServiceUsageRecorder"

// ─── the metering seam — a billed Analyser (drop-in for getAnalyser) ─────────
export { getMeteredAnalyser } from "./Composition"
