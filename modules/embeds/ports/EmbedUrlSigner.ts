// Role: turn an embed id into a URL a browser may load.
//
// The private key lives behind this interface and nowhere else, which is what
// makes "server-side only" a structural property rather than a convention —
// nothing a client component can import implements it.

/** `.webp` is the image; `.json` is the same embed's metadata. The signature
 *  binds the id, not the extension, so one signature covers both. */
export type EmbedFormat = "webp" | "json"

export interface EmbedUrlSigner {
    /** The key id Zoo has registered for us; travels in the URL as `kid`. */
    readonly kid: string

    /** An absolute, signed, currently-valid URL for `embedId`.
     *  Throws only on a malformed id or a broken key — both configuration
     *  errors, never a per-request outcome. */
    sign(embedId: string, format?: EmbedFormat): Promise<string>
}
