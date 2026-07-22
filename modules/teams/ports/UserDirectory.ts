// Teams module — the UserDirectory PORT. Identity resolution: auth-profile
// details (email / display name / avatar) for a set of user ids. auth.users lives
// outside the tracker schema and isn't readable by the `authenticated` role, so
// the adapter uses the service-role admin API. Callers MUST authorize first — this
// role does no access control of its own.
//
// ports/ may reference shared row types; it re-exports TeamMemberView so the
// application-layer TeamMemberViews service can name it without importing
// @/lib/shared/types directly (the DIP boundary bans that in application/).

import type { TeamRole } from "@/lib/shared/types"

export type { TeamMemberView } from "@/lib/shared/types"

export interface UserProfile {
    user_id: string
    email: string | null
    name: string | null
    avatar_url: string | null
}

/** A team_members row projection the member-view builder consumes. */
export interface MemberRow {
    user_id: string
    role: TeamRole
    created_at: string
}

export interface UserDirectory {
    /** Map of user_id → profile. A missing user resolves to a null-filled profile
     *  so the caller always gets an entry (a removed account still shows a row). */
    resolveProfiles(userIds: string[]): Promise<Map<string, UserProfile>>
}
