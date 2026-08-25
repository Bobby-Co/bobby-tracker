// BetaEnrollmentService — the use cases of running a closed beta: admit a
// signing-in user, invite an address, revoke one, read the list.
//
// The interesting one is `admit`. Enrolment lives in a table; the gate that runs
// on every render lives in the browser and cannot read that table. This service
// is the bridge between them, and it runs at exactly two moments — the OAuth
// callback, and POST /api/beta/access when a waitlisted user's page asks again.
//
// Orchestration only: no SDK, no Supabase types, no `User` object from the auth
// library. It speaks the three primitives it actually needs (id, email, whether
// the stamp is already there) so the module stays portable per modules/README.md.

import { BetaEmail } from "../domain/BetaEmail"
import type { BetaAllowlistEntry, BetaAllowlistRepository } from "../ports/BetaAllowlistRepository"
import type { BetaAccessStamp } from "../ports/BetaAccessStamp"

/** The caller, reduced to what an admission decision needs. */
export interface BetaIdentity {
    id: string
    email: string | null | undefined
    /** Whether the auth metadata already carries the beta flag (user_metadata
     *  .whitelisted). True short-circuits the whole check. */
    stamped: boolean
}

export class BetaEnrollmentService {
    constructor(
        private readonly allowlist: BetaAllowlistRepository,
        private readonly stamp: BetaAccessStamp,
    ) {}

    /** May this identity enter the app — and if it may, make that fact part of
     *  their session.
     *
     *  Returns true when the user is (now) admitted. THROWS on an infrastructure
     *  failure; callers decide whether to surface it or fall back to the staff
     *  bypass, but nobody gets admitted by accident. */
    async admit(identity: BetaIdentity): Promise<boolean> {
        // Already stamped — the common case by a mile, and it costs no query.
        // Note this means a revoked invitation does NOT lock a user back out; see
        // revoke() below, where that trade is made explicitly.
        if (identity.stamped) return true

        const email = BetaEmail.of(identity.email)
        if (!email) return false

        const entry = await this.allowlist.find(email)
        if (!entry) return false

        await this.stamp.grant(identity.id)

        // Audit, not authorization — the user is already through. A failure to
        // write the timestamp must not undo an admission that has landed in their
        // metadata, so it is swallowed after the fact rather than awaited for a
        // decision.
        try {
            await this.allowlist.markGranted(email, identity.id)
        } catch {
            // Intentionally silent: granted_at is a reporting column.
        }
        return true
    }

    /** Is this address invited? A pure read — no stamping, no side effects.
     *  For the admin surfaces; the gate uses admit(). */
    async isEnrolled(rawEmail: string | null | undefined): Promise<boolean> {
        const email = BetaEmail.of(rawEmail)
        if (!email) return false
        return (await this.allowlist.find(email)) !== null
    }

    /** Invite an address. Returns null when the input isn't an address at all,
     *  which the route turns into a 400 — an unparseable value is a caller
     *  mistake, not an empty result. */
    async enroll(
        rawEmail: string,
        invite: { invitedBy?: string | null; note?: string | null } = {},
    ): Promise<BetaAllowlistEntry | null> {
        const email = BetaEmail.of(rawEmail)
        if (!email) return null
        return this.allowlist.add(email, invite)
    }

    /** Withdraw an invitation.
     *
     *  HONEST LIMITATION, and the reason this isn't called "revoke access": it
     *  removes the row, so nobody NEW is admitted on that address, but a user who
     *  already signed in keeps the `whitelisted` stamp in their metadata and
     *  stays in the app. Evicting them needs the user id (revokeUser below),
     *  because the stamp is on the identity, not on the address.
     *
     *  It undoes an invitation, not an admission — and during a beta, where the
     *  usual reason to remove a row is a typo, that is the behaviour you want by
     *  default. */
    async revoke(rawEmail: string): Promise<boolean> {
        const email = BetaEmail.of(rawEmail)
        if (!email) return false
        return this.allowlist.remove(email)
    }

    /** Evict an already-admitted user: clears the metadata stamp so the gate
     *  closes on their next token refresh. Pair with revoke() to remove the
     *  invitation as well. */
    async revokeUser(userId: string): Promise<void> {
        await this.stamp.revoke(userId)
    }

    /** The whole invite list, newest first. */
    list(): Promise<BetaAllowlistEntry[]> {
        return this.allowlist.list()
    }
}
