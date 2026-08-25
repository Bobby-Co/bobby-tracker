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
export { RunAllowance } from "./application/RunAllowance"
export { SpendGate } from "./application/SpendGate"
export { getSpendGate, getPeriodUsageReader, getRunAllowance } from "./Composition"
export type { SpendRefusal, SpendRefusalReason } from "./application/SpendGate"
export { hashAccountEmail } from "./infrastructure/OwnerHash"

// ─── payments: Stripe runs the clock, we own the entitlement (0086) ──────────
// The split is forced by this stack having no scheduler: renewal, retries and
// dunning are timer-driven and Stripe is the only party here with a timer. What
// a team may DO is still decided entirely by our own tables — see
// domain/Entitlement.ts and application/SubscriptionSync.ts.
export { entitledTier, isPaidUp, FREE_TIER_ID } from "./domain/Entitlement"
export type { EntitlementStatus } from "./domain/Entitlement"
export type {
    PaymentGateway,
    CheckoutRequest,
    BillingEvent,
    InvoiceFacts,
} from "./ports/PaymentGateway"
export type { InvoicesRepository, InvoiceRow } from "./ports/InvoicesRepository"
export { createSupabaseInvoicesRepository } from "./infrastructure/SupabaseInvoicesRepository"
export { SubscriptionSync } from "./application/SubscriptionSync"
export type { SyncOutcome } from "./application/SubscriptionSync"
export type { SubscriptionPatch } from "./ports/SubscriptionsRepository"
export { BillingReconciler } from "./application/BillingReconciler"
export type { ReconcileResult } from "./application/BillingReconciler"
export { getPaymentGateway, getSubscriptionSync, getBillingReconciler } from "./Composition"

// ─── pay-as-you-go: the rule is written, the feature is OFF ──────────────────
// Eligibility only. There is no purchase path, no grant table and no UI — see
// domain/PayAsYouGo.ts for how it attaches when it is turned on.
export { payAsYouGoEligible } from "./domain/PayAsYouGo"

// ─── upgrades: leftover credits become money off the new plan ────────────────
export { quoteUpgrade } from "./domain/UpgradeCredit"
export type { UpgradeQuote } from "./domain/UpgradeCredit"
export type { ChangePlanRequest } from "./ports/PaymentGateway"
