// Teams bounded context — PUBLIC CONTRACT (see modules/README.md).
// Team invitations + membership/access-control reads. (Team-based authorization —
// team-access/assertProjectAccess — is cross-cutting and stays in lib/auth.)
export { newInviteToken, baseUrl, normalizeEmail, isValidEmail, sendInviteEmail } from "./infrastructure/invites"

export type { TeamMember, TeamMembershipRepository } from "./ports/team-membership-repository"
export { createSupabaseTeamMembershipRepository } from "./infrastructure/supabase-team-membership-repository"
