// An opaque Zoo embed id — the ONE thing we persist for an embed (never a
// signed URL, which is a bearer token with a 15–30 minute life; see the
// upstream contract §8/§9).
//
// The id is opaque to us, but it is not unconstrained: the signed payload is
// `v1.<embedId>.<exp>.<kid>` joined on ".", so an id containing a "." would make
// that join ambiguous and let a signature be re-read as a different image. It
// also lands in a URL path segment. We therefore accept only the base64url
// alphabet, which is what Zoo mints and what both constraints allow.

const EMBED_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

export class EmbedId {
    private constructor(readonly value: string) {}

    /** The id, or null when it isn't one — callers treat null as "not an embed
     *  reference" rather than an error, so junk in a body can't break a render. */
    static parse(raw: string | null | undefined): EmbedId | null {
        if (!raw) return null
        return EMBED_ID_PATTERN.test(raw) ? new EmbedId(raw) : null
    }

    toString(): string {
        return this.value
    }
}
