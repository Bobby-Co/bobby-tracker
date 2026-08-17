// Compile-time drift guard for the access context's value-objects (see the other
// modules' VoDriftGuard for the rationale). The Role value object declares its own
// `TeamRoleValue` union so the pure domain layer needn't import the DB row type;
// if that union ever diverges from the stored `TeamRole` enum, this fails to
// typecheck. Type-only: no runtime output.

import type { TeamRole } from "@/lib/shared/types"
import type { TeamRoleValue } from "../domain/Role"

/** Errors unless `Sub` is assignable to `Sup`. */
type Assignable<Sub extends Sup, Sup> = Sub

// The Role VO's local role union must stay identical to the stored enum (both
// directions), so `Role.of(dbRow.role)` and the routes' role annotations stay sound.
export type _RoleForward = Assignable<TeamRole, TeamRoleValue>
export type _RoleReverse = Assignable<TeamRoleValue, TeamRole>
