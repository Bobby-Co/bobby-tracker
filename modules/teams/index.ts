// Teams bounded context — PUBLIC CONTRACT (see modules/README.md).
// Team invitations + membership/access-control reads. (The team-based
// authorization POLICY — role gates, project visibility — lives in modules/access,
// which reads membership through this module's TeamMembershipRepository.)

// ─── invite value objects ───────────────────────────────────────────────────
export { Invite } from "./domain/Invite"
export { Email } from "./domain/Email"

// ─── invite delivery (port + composition seam) ──────────────────────────────
export type { InviteNotifier, InviteMessage } from "./ports/InviteNotifier"
export { createInviteNotifier } from "./Composition"

// ─── team membership / access reads ─────────────────────────────────────────
export type { TeamMember, TeamMembershipRepository } from "./ports/TeamMembershipRepository"
export { createSupabaseTeamMembershipRepository } from "./infrastructure/SupabaseTeamMembershipRepository"

// The team vocabulary (role + team-with-role row shapes). Re-exported so modules
// that reason over teams — notably modules/access, whose pure layers may not
// import @/lib/shared/types directly — speak them through the Teams contract.
export type { TeamRole, TeamWithRole } from "@/lib/shared/types"

// ─── identity: auth-profile resolution + member-view assembly ───────────────
export type { UserDirectory, UserProfile, MemberRow } from "./ports/UserDirectory"
export { createServiceAdminUserDirectory } from "./infrastructure/SupabaseAdminUserDirectory"
export { TeamMemberViews } from "./application/TeamMemberViews"
export { createTeamMemberViews } from "./Composition"
