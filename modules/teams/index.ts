// Teams bounded context — PUBLIC CONTRACT (see modules/README.md).
//
// Team invitations: token minting, email validation, and the invite email.
// (Team-based authorization — team-access/assertProjectAccess — is cross-cutting
// and stays in lib/auth, used by every route and the http helper.)
export * from "./infrastructure/invites"

// Membership / access-control reads — the team, access-group, and collection
// tables are Teams-owned; other contexts read them through this contract.
export type { TeamMember, TeamMembershipRepository } from "./ports/team-membership-repository"
export { createSupabaseTeamMembershipRepository } from "./infrastructure/supabase-team-membership-repository"
