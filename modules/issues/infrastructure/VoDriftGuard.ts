// Compile-time drift guard for the Issue aggregate's status enum (critique #7
// pattern). The domain's IssueStatusValue is a hand-copied duplicate of the
// stored IssueStatus union; these lines fail to typecheck if the two ever diverge
// (checked both directions). Type-only: no runtime output.

import type { IssueStatus } from "@/lib/shared/types"
import type { IssueStatusValue } from "../domain/Issue"

/** Errors unless `Sub` is assignable to `Sup`. */
type Assignable<Sub extends Sup, Sup> = Sub

export type _IssueStatusForward = Assignable<IssueStatus, IssueStatusValue>
export type _IssueStatusReverse = Assignable<IssueStatusValue, IssueStatus>
