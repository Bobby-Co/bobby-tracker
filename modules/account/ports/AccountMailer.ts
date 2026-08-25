// Account port — the account LIFECYCLE mailer. The outbound contract for the two
// moments that bracket someone's time in the product: the first, when they
// finish onboarding, and the last, when they delete the account.
//
// Callers depend on this role; the email implementation lives in infrastructure
// and is obtained through the composition root. Best-effort BY CONTRACT — see
// each method.

/** Sent once, when onboarding completes. */
export interface WelcomeMessage {
    to: string
    /** Their display name, if onboarding captured one. */
    name: string | null
    /** The workspace they named during onboarding. */
    teamName: string | null
}

/** Sent as the account is deleted — the receipt for an irreversible action. */
export interface FarewellMessage {
    to: string
    name: string | null
    /** Teams that were deleted along with the account, by name. */
    teamsDeleted: string[]
    /** Teams that survive without them, by name. */
    teamsLeft: string[]
}

export interface AccountMailer {
    /** Welcome them. NEVER throws — a failed welcome must not fail onboarding,
     *  which has already succeeded by the time this is called. */
    sendWelcome(message: WelcomeMessage): Promise<void>

    /** Confirm the deletion, and say what it took with it. NEVER throws: the
     *  account is already gone by the time this could fail, and there is no
     *  identity left to retry against. */
    sendFarewell(message: FarewellMessage): Promise<void>
}
