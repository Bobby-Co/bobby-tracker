// Compile-time drift guard for the pick-status value-object (see the pull-requests
// vo-drift-guard for the rationale — critique #7). If the ProjectInsight row stops
// being assignable to the hand-written ProjectInsightView, this fails to typecheck.
// Type-only: no runtime output.

import type { ProjectInsight } from "@/lib/supabase/types"
import type { ProjectInsightView } from "../domain/pick-status"

/** Errors unless `Sub` is assignable to `Sup`. */
type Assignable<Sub extends Sup, Sup> = Sub

export type _ProjectInsightGuard = Assignable<ProjectInsight, ProjectInsightView>
