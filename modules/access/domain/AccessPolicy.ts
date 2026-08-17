// Access module — the AccessPolicy. The two PURE decisions at the heart of the
// HYBRID authz model (migration 0052): coarse RLS proves TEAM membership; this
// policy adds the finer, role- and group-aware project gate the database
// deliberately doesn't enforce.
//
//   • scopeForRole — an owner/admin sees EVERY team project ("all"); a plain
//     member sees only the projects granted to a group they belong to.
//   • allows       — whether a resolved scope permits one specific project.
//
// Kept as a class (held as a field by AccessService) rather than free functions
// so the rule has an owner and can be unit-tested in isolation. No I/O: the group
// grants are fetched by the application service and handed in.

import { Role } from "./Role"

export class AccessPolicy {
    /** The project scope a role grants, given the project ids granted to the
     *  member's groups. Owner/admin ⇒ "all" team projects; a plain member ⇒ the
     *  distinct set of granted project ids (which may be empty ⇒ sees nothing). */
    scopeForRole(role: Role, groupGrantedIds: readonly string[]): "all" | string[] {
        if (role.atLeast("admin")) return "all"
        return Array.from(new Set(groupGrantedIds))
    }

    /** Whether a resolved scope permits a specific project. */
    allows(scope: "all" | readonly string[], projectId: string): boolean {
        return scope === "all" || scope.includes(projectId)
    }
}
