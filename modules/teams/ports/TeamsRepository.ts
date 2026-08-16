// Teams module — the teams-table persistence PORT (team lifecycle: create / read
// / rename / delete). Distinct from TeamMembershipRepository (membership + authz
// reads); this owns the `teams` row itself. RLS scopes every operation to the
// caller's teams.

import type { Team } from "@/lib/shared/types"
import type { CellId, RegionId } from "@/modules/regions"

export interface TeamsRepository {
    /** Create a non-personal team via the create_team RPC (team row + owner
     *  membership inserted atomically) and return its id. THROWS RepositoryError
     *  on failure. */
    /** Create a team at a specific placement (0065) and return its id.
     *  `region` is what the user chose; `cell` is what the registry assigned
     *  inside it. Both are required — the RPC rejects empty values rather than
     *  quietly defaulting to home, so a bug in placement resolution surfaces as
     *  an error instead of a team in the wrong hemisphere. */
    createTeam(name: string, region: RegionId, cell: CellId, userId: string): Promise<string>

    /** A team by id, or null when absent / not visible. THROWS RepositoryError on
     *  a genuine query failure (so a caller can surface a 500 vs a 404). */
    findById(id: string): Promise<Team | null>

    /** A team's display name, or null when absent. FAIL-SAFE (null on error) —
     *  used best-effort when composing an invite email. */
    findName(id: string): Promise<string | null>

    /** The cell this team's data lives in (0064 — placement is per team), or null
     *  when the team is absent or its cell is unset/malformed.
     *
     *  NOT fail-safe by omission: the caller binds the data plane with this, and a
     *  null must be treated as "cannot serve this request" rather than "use the
     *  default". Narrowed through parseCellId so a malformed column reads as
     *  unknown instead of being handed to a client factory. */
    findCell(id: string): Promise<CellId | null>

    /** Whether the team is a personal team. FAIL-SAFE: false when absent / on a
     *  query error (matches the guard's original best-effort read). */
    isPersonal(id: string): Promise<boolean>

    /** Rename a team and return the updated row. THROWS RepositoryError on failure. */
    rename(id: string, name: string): Promise<Team>

    /** Delete a team (RLS blocks personal-team deletion + non-owners). Throws. */
    delete(id: string): Promise<void>
}
