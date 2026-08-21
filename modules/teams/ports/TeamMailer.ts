// Teams port — the outbound contract for everything the team tells a PERSON
// directly, rather than through the app: you've been invited, your role changed,
// you were removed.
//
// All three share a shape — something happened to your standing in a team, and
// you weren't necessarily looking at the screen when it did. Callers depend on
// this role; the email implementation lives in infrastructure and is obtained
// via the composition root, never constructed directly. A future channel
// (in-app, Slack) is a new adapter, not a rewrite of the routes.

import type { TeamRole } from "@/lib/shared/types"

/** Everything a delivered invite needs to render itself. */
export interface InviteMessage {
    to: string
    teamName: string
    inviterName: string | null
    acceptUrl: string
    role: TeamRole
}

/** Sent when someone's role in a team changes. */
export interface RoleChangedMessage {
    to: string
    name: string | null
    teamName: string
    /** The role they held before the change. */
    previous: TeamRole
    /** The role they hold now. */
    current: TeamRole
    /** Who made the change, for the "who did this to me" question every
     *  permission change raises. Null when it can't be resolved. */
    actorName: string | null
}

/** Sent when someone is removed from a team by someone else. NOT sent when they
 *  leave on their own — nobody needs an email confirming what they just did. */
export interface RemovedFromTeamMessage {
    to: string
    name: string | null
    teamName: string
    actorName: string | null
}

export interface TeamMailer {
    /** Deliver the invitation. Best-effort by contract — a no-op when the
     *  transport is unconfigured, so the invite row is still created and can be
     *  resent. */
    sendInvite(message: InviteMessage): Promise<void>

    /** Tell someone their role changed. Best-effort: the membership row is
     *  already updated and a failed mail must not fail the change. */
    sendRoleChanged(message: RoleChangedMessage): Promise<void>

    /** Tell someone they were removed. Best-effort, same reasoning. */
    sendRemovedFromTeam(message: RemovedFromTeamMessage): Promise<void>
}
