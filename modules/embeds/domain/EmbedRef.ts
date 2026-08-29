// How an embed is WRITTEN INTO an issue body, and how it is found again.
//
// A body persists the embed id and nothing else (contract §8), so the reference
// carries no host and no signature:
//
//     ![Login button, hovered](zoo:Zm9vYmFyMTIzNDU2Nzg5)
//
// react-markdown hands that to the `img` renderer as `src="zoo:<id>"`, which is
// inert on its own — the browser can't fetch a `zoo:` URL — so a body that
// escapes to a surface with no signed map degrades to a placeholder rather than
// a broken image or, worse, a live unsigned request.
//
// Scanning is deliberately narrow: only a markdown link/image TARGET counts,
// which is exactly the position react-markdown resolves into `src`. A `zoo:` id
// mentioned in prose or a code fence is not an embed and is not signed.

export const EMBED_URI_SCHEME = "zoo:"

/** How many embeds we will sign for one body. A bound, not a product limit:
 *  each embed can cost a metadata round-trip, so a pathological body must not
 *  be able to fan out unboundedly on the render path. */
export const MAX_EMBEDS_PER_BODY = 32

const EMBED_TARGET = /\]\(\s*zoo:([A-Za-z0-9_-]{1,128})(?![A-Za-z0-9_-])[^)]*\)/g

/** The reference to persist for `embedId` (what an author writes in a body). */
export function embedRef(embedId: string): string {
    return `${EMBED_URI_SCHEME}${embedId}`
}

/** The embed id behind an `img` src, or null when the src is an ordinary URL. */
export function parseEmbedRef(src: string | null | undefined): string | null {
    if (!src || !src.startsWith(EMBED_URI_SCHEME)) return null
    const id = src.slice(EMBED_URI_SCHEME.length)
    return /^[A-Za-z0-9_-]{1,128}$/.test(id) ? id : null
}

/** Every embed id referenced by `markdown`, in order, deduped and capped. */
export function collectEmbedIds(markdown: string | null | undefined): string[] {
    if (!markdown) return []
    const seen = new Set<string>()
    for (const m of markdown.matchAll(EMBED_TARGET)) {
        seen.add(m[1])
        if (seen.size >= MAX_EMBEDS_PER_BODY) break
    }
    return [...seen]
}

/** The embed id inside whatever an author pasted, or null.
 *
 *  Accepts the three things someone plausibly has on their clipboard: a bare
 *  id, one of our own `zoo:` references, or a Zoo URL copied straight out of
 *  the browser — including a signed one, whose query string we drop on the
 *  floor. Persisting a signed URL is the one thing the contract tells us never
 *  to do (§8), so a paste is deliberately reduced to its id before it can reach
 *  a body. */
export function parsePastedEmbedId(raw: string): string | null {
    const text = raw.trim()
    if (!text) return null

    const ref = parseEmbedRef(text)
    if (ref) return ref

    // A URL or path: .../e/<id>.webp or .../e/<id>.json, query ignored.
    const path = /(?:^|\/)e\/([A-Za-z0-9_-]{1,128})\.(?:webp|json)(?:[?#]|$)/.exec(text)
    if (path) return path[1]

    return /^[A-Za-z0-9_-]{1,128}$/.test(text) ? text : null
}
