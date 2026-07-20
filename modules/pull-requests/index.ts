// Pull Requests bounded context — PUBLIC CONTRACT (see modules/README.md).
// Explicit exports only: the PR-comment body renderers (loadingComment etc.) are
// module internals used by pr-sync, not part of this contract.

// finding-state is a SHARED pure classifier (lib/rendering/finding-state) used by
// both this module's merge gate and presentation; re-exported here for callers
// that reach for it via the Pull Requests contract.
export type { FindingState } from "@/lib/rendering/finding-state"
export { findingState } from "@/lib/rendering/finding-state"

// Merge policy (domain)
export type { MergeMethod, MergeMethods, MergeGate, MergeBlock, MergeBlockCode } from "./domain/merge-gate"
export { mergeGate, criticalFindingCount, defaultMergeMethod, MERGE_METHOD_LABEL } from "./domain/merge-gate"

// PR-analysis orchestration
export { startPRAnalysis, applyPRResult, cancelPRAnalysisForPR } from "./infrastructure/pr-sync"

// PR mirror store + backfill
export { upsertPullRequest, upsertPRComment, deletePRComment, findPRAnalysisResult } from "./infrastructure/pr-store"
export { backfillPullRequests, backfillPullRequestComments, backfillIssueComments } from "./infrastructure/pr-backfill"
