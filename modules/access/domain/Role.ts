// Access module — the Role value object. A member's standing in a team, ordered
// owner > admin > member, with the single null-safe comparison the authz rules
// lean on (`Role.of(role).atLeast("admin")`). This replaces the loose
// `roleAtLeast(role, min)` helper that used to live in lib/auth/team-access.ts.
//
// PURE domain: it must not import the DB row type (`TeamRole` from
// @/lib/shared/types) — the DIP boundary bans that here — so the role values are
// declared locally as `TeamRoleValue` and kept in lock-step with the stored enum
// by a compile-time drift guard in ../infrastructure/VoDriftGuard.ts.

/** The role values, owner > admin > member. Structurally identical to the stored
 *  `TeamRole` enum (see the drift guard); declared locally to keep this layer pure. */
export type TeamRoleValue = "owner" | "admin" | "member"

export class Role {
    private static readonly RANK: Record<TeamRoleValue, number> = { member: 1, admin: 2, owner: 3 }

    private constructor(private readonly role: TeamRoleValue | null) {}

    /** Wrap a role value. `null`/`undefined` means "not a member" — never at least
     *  anything, so every gate fails closed for a non-member. */
    static of(value: TeamRoleValue | null | undefined): Role {
        return new Role(value ?? null)
    }

    /** True when this role is at least `min` in the owner > admin > member order. */
    atLeast(min: TeamRoleValue): boolean {
        if (!this.role) return false
        return Role.RANK[this.role] >= Role.RANK[min]
    }

    /** The underlying role value, or null when not a member. */
    get value(): TeamRoleValue | null {
        return this.role
    }
}
