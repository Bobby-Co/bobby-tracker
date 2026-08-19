// Billing bounded context — PUBLIC CONTRACT (see modules/README.md). "Prowl" is
// Ucelot's usage-metering & credits system: every model call spends Prowl Points
// drawn from a team's monthly, tier-based allowance. Import only from here.
//
// RECORDING lives in the ANALYSER, not here: bobby-analyser writes each billable
// call straight to tracker.prowl_usage_events (its internal/server/usage.go), so
// this module is READ-ONLY over the ledger — it owns the tiers, the Prowl-Points
// vocabulary, the balance maths, and the read repositories the UI/API consume.
// Prowl Points themselves are a generated column on the ledger (derived from
// cost_usd; POINTS_PER_USD below documents the rate that column uses).

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
export type { UsageRepository, UsageEventRow, UsageByKind, PeriodUsage } from "./ports/UsageRepository"
export { createSupabaseUsageRepository } from "./infrastructure/SupabaseUsageRepository"

// ─── the free-team quota + durable billing identity (0076) ───────────────────
// Usage belongs to a SUBJECT keyed by a hash of the owner's email, not to a team.
// Teams bind to a subject, so deleting a team (or the whole account) no longer
// resets the monthly allowance — the replacement rebinds to the same subject and
// inherits its balance. Two reserved slots per email (personal + free); anything
// beyond that needs a paid plan. Suspending a team releases its slot.
export { SlotPolicy } from "./domain/SlotPolicy"
export type { SlotKind, SubjectStatus, SubjectFacts, Allocation, PlanEndAction } from "./domain/SlotPolicy"
export type { UsageSubjectStore } from "./ports/UsageSubjectStore"
export { createSupabaseUsageSubjectStore } from "./infrastructure/SupabaseUsageSubjectStore"
export { PeriodUsageReader } from "./application/PeriodUsageReader"
export { SpendGate } from "./application/SpendGate"
export { getSpendGate } from "./Composition"
export type { SpendRefusal } from "./application/SpendGate"
export { hashAccountEmail } from "./infrastructure/OwnerHash"
