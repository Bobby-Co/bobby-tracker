// The server→client DTO for one embed. Plain data on purpose: it crosses the
// prop boundary into a client component, so it holds no behaviour and no key.
//
// `src` is the only thing the browser ever sees of the signing scheme, and it
// is regenerated on every render — never persisted, never cached by us.

/** Whether the embed can be rendered at all. `missing`/`revoked` are Zoo's 404
 *  and 410: we learned them server-side, so the client shows the right words
 *  instead of a broken image. */
export type EmbedAvailability = "ok" | "missing" | "revoked"

export interface SignedEmbed {
    embedId: string
    /** Zoo's name for the component this render came from, when metadata was
     *  readable. The only human-legible handle an embed id has — a picker lists
     *  by it, and an author's alt text starts from it. */
    componentId: string | null
    /** Absolute signed image URL. Null exactly when the embed is not renderable. */
    src: string | null
    /** CSS px from Zoo's metadata, when we could read it — set on the <img> to
     *  reserve space (contract §8). Null means we render without reserving. */
    w: number | null
    h: number | null
    state: EmbedAvailability
}

/** Keyed by embed id — what a page hands its markdown renderer. */
export type SignedEmbedMap = Record<string, SignedEmbed>
