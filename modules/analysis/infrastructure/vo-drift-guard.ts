// Compile-time drift guard for the ProjectAnalyser aggregate's status enum
// (critique #7 pattern). AnalyserStatusValue is a hand-copied duplicate of the
// stored AnalyserStatus union; these lines fail to typecheck if they diverge
// (both directions). Type-only: no runtime output.

import type { AnalyserStatus } from "@/lib/supabase/types"
import type { AnalyserStatusValue } from "../domain/project-analyser"

/** Errors unless `Sub` is assignable to `Sup`. */
type Assignable<Sub extends Sup, Sup> = Sub

export type _AnalyserStatusForward = Assignable<AnalyserStatus, AnalyserStatusValue>
export type _AnalyserStatusReverse = Assignable<AnalyserStatusValue, AnalyserStatus>
