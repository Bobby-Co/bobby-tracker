// Teams module — composition root. Constructs the concrete TeamMailer. A future
// channel (a different mail provider, an in-proc test stub) is injected here
// without touching the routes — they depend on the port and obtain an
// implementation through this seam.

import type { TeamMailer } from "./ports/TeamMailer"
import { JmapTeamMailer } from "./infrastructure/JmapTeamMailer"
import { TeamMemberViews } from "./application/TeamMemberViews"
import { createServiceAdminUserDirectory } from "./infrastructure/SupabaseAdminUserDirectory"

/** The app-wide TeamMailer (the JMAP email adapter today). */
export function createTeamMailer(): TeamMailer {
    return new JmapTeamMailer()
}

/** The member-view builder, backed by the service-role admin UserDirectory. */
export function createTeamMemberViews(): TeamMemberViews {
    return new TeamMemberViews(createServiceAdminUserDirectory())
}
