// The waitlist queue (tracker.beta_requests, migration 0074) — the PORT.
//
// The list you enrol FROM. Kept apart from BetaAllowlistRepository because they
// are opposite halves of the same workflow and conflating them is how a "request"
// accidentally becomes an "invitation".

import type { BetaEmail } from "../domain/BetaEmail"

export interface BetaRequest {
    email: string
    user_id: string | null
    display_name: string | null
    requested_at: string
    source: string
}

export interface BetaWaitlistRepository {
    /** Record a request to join. Idempotent per address — pressing the button
     *  twice keeps the ORIGINAL requested_at, because position in the queue is
     *  the only thing this timestamp is for. */
    record(email: BetaEmail, who: { userId?: string | null; displayName?: string | null; source?: string }): Promise<boolean>

    /** The queue, longest-waiting first. */
    list(limit?: number): Promise<BetaRequest[]>

    /** Drop an address from the queue. Used when an account is deleted — someone
     *  who no longer exists should not still be waiting in line. Silent when
     *  there is no row. */
    remove(email: BetaEmail): Promise<void>
}
