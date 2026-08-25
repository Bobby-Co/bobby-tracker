// Beta port — the mailer for the two moments the beta gate produces news.
//
// Both are worth an email for the same reason: neither is visible in the app at
// the time it happens. Joining the queue produces a page that says "you're on
// the list" and then nothing ever again; being enrolled happens on a STAFF
// screen, in a table the invitee cannot see, possibly days before they next
// visit. Without these two mails the beta is a room with no door bell.
//
// Callers depend on this role; the email implementation lives in infrastructure
// and is obtained through the composition root.

/** Sent when someone joins the queue (POST /api/beta/request). */
export interface WaitlistJoinedMessage {
    to: string
    name: string | null
}

/** Sent when staff enrol an address (POST /api/beta/allowlist). */
export interface BetaAccessMessage {
    to: string
    /** The staff note attached to the invitation, when there is one. Never
     *  rendered verbatim as a reason — see the adapter. */
    note: string | null
}

export interface BetaMailer {
    /** Confirm a place in the queue. NEVER throws — the row is already recorded
     *  and a failed confirmation must not turn joining into an error. */
    sendWaitlistJoined(message: WaitlistJoinedMessage): Promise<void>

    /** Tell someone their invitation is live. NEVER throws — the invitation
     *  exists in the table either way, and staff should not see enrolment fail
     *  because a mail server was down. */
    sendAccessGranted(message: BetaAccessMessage): Promise<void>
}
