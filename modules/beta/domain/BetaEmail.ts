// BetaEmail — the beta list's key, normalised.
//
// Every address in this context arrives from somewhere sloppy: an identity
// provider that reports "Foo@Example.com", a form the team types into, a SQL
// editor with a trailing space. The allowlist is matched by EQUALITY on the
// stored string, so one un-normalised value is an invitation that can never be
// redeemed and gives no hint why.
//
// So the address is a value object with a private constructor: it cannot exist
// in an unnormalised form, and `of()` is the only way in. The same normalisation
// is asserted a second time by a CHECK constraint in migration 0074 — deliberate
// belt and braces, because rows also get inserted by hand.
export class BetaEmail {
    private constructor(readonly value: string) {}

    /** Normalise and validate. Returns null for anything that isn't an address —
     *  an anonymous caller, a provider that returned no email, a typo'd form. */
    static of(raw: string | null | undefined): BetaEmail | null {
        const value = (raw ?? "").trim().toLowerCase()
        // Not an RFC validator, and shouldn't be: these addresses come from an
        // identity provider that already proved deliverability. This only rejects
        // what is obviously not an address at all.
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return null
        return new BetaEmail(value)
    }

    toString(): string {
        return this.value
    }
}
