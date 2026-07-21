// Compile-time drift guards for the merge-gate value-objects.
//
// merge-gate/domain hand-writes MergePull/MergeReview instead of importing the DB
// row types (so the pure gate carries no SDK dependency). The risk that critique
// #7 named: those VOs can silently diverge from the real schema. These guards
// close it — if a tracker row in @/lib/supabase/types stops being assignable to
// the VO the gate expects, THIS file fails to typecheck, right here, instead of
// at some distant call site (or not at all). Type-only: no runtime output.
//
// (This catches VO↔type drift. Type↔real-DB drift still needs schema codegen,
// which this environment can't run — the types in supabase/types are hand-kept.)

import type { PullRequest, PullRequestAnalysis } from "@/lib/supabase/types"
import type { MergePull, MergeReview } from "../domain/MergeGate"

/** Errors unless `Sub` is assignable to `Sup`. */
type Assignable<Sub extends Sup, Sup> = Sub

export type _MergePullGuard = Assignable<PullRequest, MergePull>
export type _MergeReviewGuard = Assignable<PullRequestAnalysis, MergeReview>
