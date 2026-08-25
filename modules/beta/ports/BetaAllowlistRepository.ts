// The beta enrolment list (tracker.beta_allowlist, migration 0074) — the PORT.
//
// Server-side only, always bound to a service-role client: RLS on that table is
// enabled with no policies, so a browser-bound client reads zero rows and would
// report every user as un-enrolled. See modules/beta/index.ts for the whole flow.

import type { BetaEmail } from "../domain/BetaEmail"

/** One invitation. `granted_*` is stamped the first time the address signs in
 *  and is let through — null means "invited, never showed up". */
export interface BetaAllowlistEntry {
    email: string
    invited_by: string | null
    note: string | null
    created_at: string
    granted_at: string | null
    granted_user: string | null
}

export interface BetaAllowlistRepository {
    /** The invitation for an address, or null when it isn't on the list.
     *  THROWS RepositoryError on a genuine query failure — an enrolment gate that
     *  fails open on a database error is a gate that doesn't exist. */
    find(email: BetaEmail): Promise<BetaAllowlistEntry | null>

    /** The whole list, newest invitation first. Global by nature: this table has
     *  no tenant to scope it to (see repository-scoping.test.ts). */
    list(): Promise<BetaAllowlistEntry[]>

    /** Invite an address (UPSERT — re-inviting updates the note rather than
     *  failing, and never clears an existing grant). */
    add(email: BetaEmail, invite: { invitedBy?: string | null; note?: string | null }): Promise<BetaAllowlistEntry>

    /** Remove an invitation. Returns whether a row was actually there.
     *
     *  NOTE this does not evict anyone already admitted — their `whitelisted`
     *  metadata stamp outlives the row; see BetaEnrollmentService.revoke. */
    remove(email: BetaEmail): Promise<boolean>

    /** Record that this address was admitted, the first time it happens.
     *  Idempotent: a later sign-in must not overwrite the original timestamp. */
    markGranted(email: BetaEmail, userId: string): Promise<void>
}
