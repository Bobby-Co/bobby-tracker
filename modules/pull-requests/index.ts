// Pull Requests bounded context — PUBLIC CONTRACT (see modules/README.md).
//
// Domain: finding-severity policy + the merge gate (the single source of truth
// for "may this PR be merged from inside the tracker?"). Infrastructure: PR
// analysis orchestration, the tracker PR/comment mirror store, GitHub backfill,
// and PR-comment rendering. Other code imports ONLY this barrel.
export type { FindingState } from "./domain/finding-severity"
export { findingState } from "./domain/finding-severity"
export * from "./domain/merge-gate"
export * from "./infrastructure/pr-sync"
export * from "./infrastructure/pr-store"
export * from "./infrastructure/pr-backfill"
export * from "./infrastructure/pr-comment"
