// Pull Requests module — PUBLIC CONTRACT (see modules/README.md). Grows as PR
// logic (merge policy, review orchestration) migrates in from lib/pr-sync.ts,
// lib/pulls/merge-gate.ts, and the rendering that leaked into lib/badge.ts.

export type { FindingState } from "./domain/finding-severity"
export { findingState } from "./domain/finding-severity"
