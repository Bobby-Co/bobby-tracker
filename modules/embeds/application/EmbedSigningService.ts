// The use case behind every signed embed: "this viewer may see this content —
// vouch for it."
//
// The vouching is the whole point of the scheme (contract §2). Zoo does not
// know our permission model; it only verifies that someone holding our key said
// yes. So this service must be reached ONLY after the caller's own access check
// has passed — it deliberately takes no viewer and makes no authorization
// decision of its own, because a service that could be asked "is this allowed?"
// would eventually be asked by something that had not checked.
//
// It signs; it does not persist. Every call mints URLs valid for one bucket
// window, which is why callers invoke it at render time rather than at write
// time (contract §8).

import { EmbedId } from "../domain/EmbedId"
import { collectEmbedIds, MAX_EMBEDS_PER_BODY } from "../domain/EmbedRef"
import type { SignedEmbed, SignedEmbedMap } from "../domain/SignedEmbed"
import type { EmbedMetadataSource } from "../ports/EmbedMetadataSource"
import type { EmbedUrlSigner } from "../ports/EmbedUrlSigner"

export class EmbedSigningService {
    constructor(
        private readonly signer: EmbedUrlSigner,
        /** Optional: without it embeds still render, just without reserved
         *  dimensions and without server-side knowledge of 404/410. */
        private readonly metadata: EmbedMetadataSource | null = null,
    ) {}

    /** Sign every embed referenced by an issue body. Returns `{}` for a body
     *  with no references — the common case, and it costs nothing. */
    async forMarkdown(markdown: string | null | undefined): Promise<SignedEmbedMap> {
        return this.forIds(collectEmbedIds(markdown))
    }

    async forIds(ids: readonly string[]): Promise<SignedEmbedMap> {
        if (ids.length === 0) return {}
        const signed = await Promise.all(ids.slice(0, MAX_EMBEDS_PER_BODY).map((id) => this.describeAndSign(id)))
        const out: SignedEmbedMap = {}
        for (const embed of signed) if (embed) out[embed.embedId] = embed
        return out
    }

    /** Null for an id that isn't a well-formed embed id — junk in a body is not
     *  an error, it just isn't an embed. */
    private async describeAndSign(rawId: string): Promise<SignedEmbed | null> {
        const id = EmbedId.parse(rawId)
        if (!id) return null

        const described = this.metadata
            ? await this.metadata.describe(id.value)
            : ({ state: "ok", metadata: null } as const)

        // Gone means gone: emit no URL at all. A signature would still verify —
        // revocation is not bound to signatures (contract §9) — so the only way
        // to tell the viewer something useful is to not send them to Zoo.
        if (described.state !== "ok") {
            return { embedId: id.value, componentId: null, src: null, w: null, h: null, state: described.state }
        }

        return {
            embedId: id.value,
            componentId: described.metadata?.componentId ?? null,
            src: await this.signer.sign(id.value),
            w: described.metadata?.w ?? null,
            h: described.metadata?.h ?? null,
            state: "ok",
        }
    }
}
