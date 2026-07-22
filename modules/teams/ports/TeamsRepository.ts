// Teams module — the teams-table persistence PORT (team lifecycle: create / read
// / rename / delete). Distinct from TeamMembershipRepository (membership + authz
// reads); this owns the `teams` row itself. RLS scopes every operation to the
// caller's teams.

import type { Team } from "@/lib/shared/types"

export interface TeamsRepository {
    /** Create a non-personal team via the create_team RPC (team row + owner
     *  membership inserted atomically) and return its id. THROWS RepositoryError
     *  on failure. */
    createTeam(name: string): Promise<string>

    /** A team by id, or null when absent / not visible. THROWS RepositoryError on
     *  a genuine query failure (so a caller can surface a 500 vs a 404). */
    findById(id: string): Promise<Team | null>

    /** Whether the team is a personal team. FAIL-SAFE: false when absent / on a
     *  query error (matches the guard's original best-effort read). */
    isPersonal(id: string): Promise<boolean>

    /** Rename a team and return the updated row. THROWS RepositoryError on failure. */
    rename(id: string, name: string): Promise<Team>

    /** Delete a team (RLS blocks personal-team deletion + non-owners). Throws. */
    delete(id: string): Promise<void>
}
