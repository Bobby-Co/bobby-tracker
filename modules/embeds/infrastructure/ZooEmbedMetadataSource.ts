// Reads `/e/<id>.json` — Zoo's answer to "how big is it, and does it still
// exist?" (contract §1, §6).
//
// Two things make putting a network call on the render path acceptable:
//
//   1. It only happens for a body that actually references an embed, and
//   2. embeds are IMMUTABLE — an id addresses one frozen render forever — so a
//      cached answer is correct rather than merely fresh-enough.
//
// The cache still carries a TTL, and that TTL is about revocation, not size:
// an owner revoking an embed makes it 410 immediately, and we want to notice
// within minutes rather than for the life of the isolate.
//
// Every failure that isn't a definite 404/410 degrades to "renderable, size
// unknown". A metadata endpoint we can't reach must cost us reserved space, not
// the image — the signature is valid whatever this call says.

import type { Clock } from "@/lib/shared/kernel"
import type { EmbedDescription, EmbedMetadataSource } from "../ports/EmbedMetadataSource"
import type { EmbedUrlSigner } from "../ports/EmbedUrlSigner"

const CACHE_TTL_MS = 10 * 60 * 1000
/** Shorter for "we couldn't tell": retry soon, but not on every render. */
const UNRESOLVED_TTL_MS = 30 * 1000
const MAX_CACHE_ENTRIES = 512
const DEFAULT_TIMEOUT_MS = 2500

interface CacheEntry {
    description: EmbedDescription
    expiresAtMs: number
}

export class ZooEmbedMetadataSource implements EmbedMetadataSource {
    private readonly cache = new Map<string, CacheEntry>()

    constructor(
        private readonly signer: EmbedUrlSigner,
        private readonly clock: Clock,
        /** Workers' fetch sends no User-Agent unless told to, and some hosts
         *  answer 403 to a request without one (see the GitHub API). Cheap
         *  insurance; costs nothing if Zoo doesn't care. */
        private readonly userAgent = "bobby-tracker",
        private readonly timeoutMs = DEFAULT_TIMEOUT_MS,
    ) {}

    async describe(embedId: string): Promise<EmbedDescription> {
        const cached = this.cache.get(embedId)
        if (cached && cached.expiresAtMs > this.clock.now().getTime()) return cached.description

        const described = await this.fetchDescription(embedId)
        const unresolved = described.state === "ok" && described.metadata === null
        return this.remember(embedId, described, unresolved ? UNRESOLVED_TTL_MS : CACHE_TTL_MS)
    }

    private async fetchDescription(embedId: string): Promise<EmbedDescription> {
        try {
            const response = await fetch(await this.signer.sign(embedId, "json"), {
                headers: { accept: "application/json", "user-agent": this.userAgent },
                signal: AbortSignal.timeout(this.timeoutMs),
            })

            if (response.status === 404) return { state: "missing" }
            if (response.status === 410) return { state: "revoked" }
            // 403 lands here: a signing or clock-skew problem on our side, which
            // the image request will hit too. Nothing useful to say about size,
            // and nothing that makes the embed "gone".
            if (!response.ok) return { state: "ok", metadata: null }

            const body = (await response.json()) as Record<string, unknown>
            return {
                state: "ok",
                metadata: {
                    componentId: typeof body.componentId === "string" ? body.componentId : null,
                    w: positiveInt(body.w),
                    h: positiveInt(body.h),
                    contentType: typeof body.contentType === "string" ? body.contentType : null,
                },
            }
        } catch {
            // Timeout, DNS, TLS, malformed JSON — all the same to a reader.
            return { state: "ok", metadata: null }
        }
    }

    private remember(embedId: string, description: EmbedDescription, ttlMs: number): EmbedDescription {
        // Oldest-inserted eviction. A plain bound on an in-isolate map, not an
        // LRU — the working set is "embeds on pages this isolate served".
        if (this.cache.size >= MAX_CACHE_ENTRIES) {
            const oldest = this.cache.keys().next()
            if (!oldest.done) this.cache.delete(oldest.value)
        }
        this.cache.set(embedId, { description, expiresAtMs: this.clock.now().getTime() + ttlMs })
        return description
    }
}

function positiveInt(value: unknown): number | null {
    return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null
}
