// Compile-time drift guard for the public-reporter status value-object (critique
// #7). PublicIssueStatus is a hand-copied duplicate of the stored IssueStatus
// union; these two lines fail to typecheck if the unions ever diverge (checked
// both directions, since they must stay identical). Type-only: no runtime output.

import type { IssueStatus, PublicSessionAccessMode, PublicSessionSubmissionsVisibility } from "@/lib/supabase/types"
import type { PublicIssueStatus } from "../domain/PublicReporter"
import type { PublicSessionAccessModeValue, PublicSessionSubmissionsVisibilityValue } from "../domain/PublicSession"

/** Errors unless `Sub` is assignable to `Sup`. */
type Assignable<Sub extends Sup, Sup> = Sub

export type _StatusGuardForward = Assignable<IssueStatus, PublicIssueStatus>
export type _StatusGuardReverse = Assignable<PublicIssueStatus, IssueStatus>

// PublicSession aggregate enums must stay identical to the stored ones.
export type _AccessModeF = Assignable<PublicSessionAccessMode, PublicSessionAccessModeValue>
export type _AccessModeR = Assignable<PublicSessionAccessModeValue, PublicSessionAccessMode>
export type _VisibilityF = Assignable<PublicSessionSubmissionsVisibility, PublicSessionSubmissionsVisibilityValue>
export type _VisibilityR = Assignable<PublicSessionSubmissionsVisibilityValue, PublicSessionSubmissionsVisibility>
