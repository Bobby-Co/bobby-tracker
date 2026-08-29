// Role: what Zoo knows about an embed — its pixel size, and whether it still
// exists at all.
//
// Two jobs in one call, because one round-trip answers both: dimensions let the
// <img> reserve space (contract §8), and the 404/410 status lets us render
// "removed" as words rather than emitting a URL the browser will fail on
// (contract §6). Every failure that isn't a definite 404/410 resolves to
// "ok, dimensions unknown" — an unreachable metadata endpoint must degrade the
// layout, never the image.

export interface EmbedMetadata {
    componentId: string | null
    /** CSS px. The stored render is DPR 2, so natural size stays crisp. */
    w: number | null
    h: number | null
    contentType: string | null
}

export type EmbedDescription =
    | { state: "ok"; metadata: EmbedMetadata | null }
    | { state: "missing" }
    | { state: "revoked" }

export interface EmbedMetadataSource {
    /** Never throws — an unreachable Zoo yields `{ state: "ok", metadata: null }`. */
    describe(embedId: string): Promise<EmbedDescription>
}
