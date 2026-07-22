// Teams module — the team_invites persistence PORT (pending invitations). RLS on
// team_invites is admin-only, so a non-admin never sees the tokens.

import type { TeamInvite, TeamRole } from "@/lib/shared/types"

/** The fields needed to create a pending invite. */
export interface NewInvite {
    teamId: string
    email: string
    role: TeamRole
    token: string
    invitedBy: string
    expiresAt: string
}

/** Create outcome: the created row, or a "duplicate" signal when the partial-
 *  unique "one live invite per email per team" constraint (23505) fired — the
 *  route maps that to a 409 rather than a 500. */
export type InviteCreateResult = { ok: true; invite: TeamInvite } | { ok: false; reason: "duplicate" }

export interface TeamInvitesRepository {
    /** Pending (unaccepted) invites for a team, newest first. THROWS on failure. */
    listPending(teamId: string): Promise<TeamInvite[]>

    /** Create a pending invite (see InviteCreateResult for the duplicate case).
     *  Throws RepositoryError on any non-duplicate failure. */
    create(input: NewInvite): Promise<InviteCreateResult>

    /** Revoke a pending invite by token. Throws on failure. */
    revoke(teamId: string, token: string): Promise<void>
}
