// Teams module — composition root. Constructs the concrete InviteNotifier. A
// future channel (a different mail provider, an in-proc test stub) is injected
// here without touching the invite route — it depends on the port and obtains an
// implementation through this seam.

import type { InviteNotifier } from "./ports/InviteNotifier"
import { JmapInviteNotifier } from "./infrastructure/JmapInviteNotifier"
import { TeamMemberViews } from "./application/TeamMemberViews"
import { createServiceAdminUserDirectory } from "./infrastructure/SupabaseAdminUserDirectory"

/** The app-wide InviteNotifier (the JMAP email adapter today). */
export function createInviteNotifier(): InviteNotifier {
    return new JmapInviteNotifier()
}

/** The member-view builder, backed by the service-role admin UserDirectory. */
export function createTeamMemberViews(): TeamMemberViews {
    return new TeamMemberViews(createServiceAdminUserDirectory())
}
