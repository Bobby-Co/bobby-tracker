// Account port — the record of whether someone has already been welcomed.
//
// A welcome email has to be sent exactly once, and the moment it belongs to —
// onboarding finishing — happens in the BROWSER, where anything can be retried,
// double-submitted or reloaded. So "have we already done this?" cannot live in
// the caller; it has to be a server-side fact that the send is gated on.
export interface WelcomeLedger {
    /** Claim the right to welcome this user, returning false if someone already
     *  has. Best-effort ONCE, not atomic: it reads the mark and writes it, so two
     *  genuinely simultaneous calls could both win. That window is one person
     *  double-submitting an onboarding form, and the cost of losing it is a
     *  duplicate welcome — not worth a lock.
     *
     *  Returns false (rather than throwing) when the mark can't be read or
     *  written, so an identity-provider blip results in NO email rather than an
     *  unbounded stream of them. */
    claim(userId: string): Promise<boolean>
}
