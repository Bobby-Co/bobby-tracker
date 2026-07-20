// Pull Requests bounded context — PUBLIC CONTRACT (see modules/README.md).
//
// Domain: finding-severity policy + the merge gate (the single source of truth
// for "may this PR be merged from inside the tracker?"). Infrastructure: PR
// analysis orchestration, the tracker PR/comment mirror store, GitHub backfill,
// and PR-comment rendering. Other code imports ONLY this barrel.
// finding-state is a SHARED pure classifier (lib/rendering/finding-state) used by
// both this module's merge gate and presentation; re-exported here for callers
// that already reach for it via the Pull Requests contract.
export type { FindingState } from "@/lib/rendering/finding-state"
export { findingState } from "@/lib/rendering/finding-state"
export * from "./domain/merge-gate"
export * from "./infrastructure/pr-sync"
export * from "./infrastructure/pr-store"
export * from "./infrastructure/pr-backfill"
export * from "./infrastructure/pr-comment"
