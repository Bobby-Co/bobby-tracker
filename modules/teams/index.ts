// Teams bounded context — PUBLIC CONTRACT (see modules/README.md).
// Team invitations + membership/access-control reads. (Team-based authorization —
// team-access/assertProjectAccess — is cross-cutting and stays in lib/auth.)

// ─── invite value helpers (pure) ────────────────────────────────────────────
export { newInviteToken, baseUrl, normalizeEmail, isValidEmail } from "./domain/Invite"

// ─── invite delivery (port + composition seam) ──────────────────────────────
export type { InviteNotifier, InviteMessage } from "./ports/InviteNotifier"
export { createInviteNotifier } from "./Composition"

// ─── team membership / access reads ─────────────────────────────────────────
export type { TeamMember, TeamMembershipRepository } from "./ports/TeamMembershipRepository"
export { createSupabaseTeamMembershipRepository } from "./infrastructure/SupabaseTeamMembershipRepository"
