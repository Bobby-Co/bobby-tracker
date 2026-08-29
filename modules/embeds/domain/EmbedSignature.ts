// The canonical bytes we sign for an embed URL — upstream contract §5.
//
//     v1.<embedId>.<exp>.<kid>
//
// `embedId` is bound in so a signature can't be moved to a different image, and
// `kid` so it can't be replayed against another registered key. All three
// fields use charsets that exclude ".", which is what makes joining on "."
// unambiguous — this file is the one place that invariant is enforced, because
// breaking it silently produces signatures that verify against the wrong image.

export const EMBED_SIGNATURE_VERSION = "v1"

/** The key id charset: URL-safe and "."-free. Shaped like `issues-prod-1`. */
const KID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

export function isValidKid(kid: string): boolean {
    return KID_PATTERN.test(kid)
}

/** The exact UTF-8 string to sign. Throws on inputs that would make the "."
 *  join ambiguous — a configuration bug we want loud, not silently mis-signed. */
export function embedSigningPayload(embedId: string, exp: number, kid: string): string {
    if (embedId.includes(".")) throw new Error(`embed id must not contain "." (got ${JSON.stringify(embedId)})`)
    if (!isValidKid(kid)) throw new Error(`kid must match ${KID_PATTERN} (got ${JSON.stringify(kid)})`)
    if (!Number.isInteger(exp) || exp <= 0) throw new Error(`exp must be a positive integer (got ${exp})`)
    return `${EMBED_SIGNATURE_VERSION}.${embedId}.${exp}.${kid}`
}
