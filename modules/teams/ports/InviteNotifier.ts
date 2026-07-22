// Teams port — the invitation notifier. The outbound contract for delivering a
// team invite to a person. Callers depend on this role; the email
// implementation lives in infrastructure and is obtained via the composition
// root, never constructed directly. A future channel (in-app, SMS) is a new
// adapter, not a rewrite of the invite route.

import type { TeamRole } from "@/lib/shared/types"

/** Everything a delivered invite needs to render itself. */
export interface InviteMessage {
    to: string
    teamName: string
    inviterName: string | null
    acceptUrl: string
    role: TeamRole
}

export interface InviteNotifier {
    /** Deliver the invitation. Best-effort by contract — a no-op when the
     *  transport is unconfigured, so the invite row is still created and can be
     *  resent. */
    sendInvite(message: InviteMessage): Promise<void>
}
