// Compile-time drift guards for the projects context's value-objects (see the
// vcs PrVoDriftGuard for the rationale — critique #7). If the stored ProjectInsight
// row stops being assignable to the ProjectInsight aggregate's local
// ProjectInsightState, this fails to typecheck. Type-only: no runtime output.

import type { GithubSyncDirection, ProjectInsight as ProjectInsightRow } from "@/lib/shared/types"
import type { ProjectInsightState } from "../domain/ProjectInsight"
import type { SyncDirection } from "../domain/Project"

/** Errors unless `Sub` is assignable to `Sup`. */
type Assignable<Sub extends Sup, Sup> = Sub

export type _ProjectInsightGuard = Assignable<ProjectInsightRow, ProjectInsightState>

// The Project aggregate's local SyncDirection must stay identical to the stored
// enum (checked both directions).
export type _SyncDirectionForward = Assignable<GithubSyncDirection, SyncDirection>
export type _SyncDirectionReverse = Assignable<SyncDirection, GithubSyncDirection>
