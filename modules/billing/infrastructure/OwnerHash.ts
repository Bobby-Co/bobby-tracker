// The owner hash — how a billing identity is keyed to a person.
//
// SHA-256 of the lower-cased email. The email is the only identifier that
// survives an account being deleted and recreated (user ids are not), and this is
// the only form of it the billing tables ever store: usage_subjects rows are
// PERMANENT, so the key has to answer "is this the same person?" without the
// table becoming a lasting record of everyone who ever signed up.
//
// BOBBY_ACCOUNT_PEPPER, when set, is mixed in so digests can't be matched against
// a precomputed list of common addresses. Set it in production and do not rotate
// it casually: rotation orphans every existing subject, which hands each of those
// addresses a fresh free allowance.
//
// Web Crypto rather than node:crypto — this runs on Workers.
export async function hashAccountEmail(email: string): Promise<string> {
    const pepper = process.env.BOBBY_ACCOUNT_PEPPER ?? ""
    const data = new TextEncoder().encode(`${email.trim().toLowerCase()}${pepper}`)
    const digest = await crypto.subtle.digest("SHA-256", data)
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("")
}
