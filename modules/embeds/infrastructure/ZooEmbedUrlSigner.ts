// Zoo's URL-signing scheme, implemented against Web Crypto — the one place in
// the app that touches the embed private key.
//
// Web Crypto rather than node:crypto because this runs on Workers (the same
// reason SyncHash and OwnerHash use it). The contract's reference snippet is
// Node's `sign()`; this is the same algorithm — raw Ed25519 over the UTF-8
// payload bytes, no pre-hash — and it is pinned to the contract's §7 test
// vectors in the sibling test, which is the only way to know the two agree.
//
// Web Crypto has no "import a raw Ed25519 seed" path — only PKCS#8. The 16-byte
// prefix below is the fixed DER header for an Ed25519 private key
// (OID 1.3.101.112) wrapping a 32-byte seed, so prefix + seed is a valid PKCS#8
// document. This is exactly what the contract's `privateKeyFromRaw` does.

import type { Clock } from "@/lib/shared/kernel"
import { EmbedId } from "../domain/EmbedId"
import { embedExpiry } from "../domain/EmbedExpiry"
import { embedSigningPayload, isValidKid } from "../domain/EmbedSignature"
import type { EmbedFormat, EmbedUrlSigner } from "../ports/EmbedUrlSigner"

// SEQUENCE { INTEGER 0, SEQUENCE { OID 1.3.101.112 }, OCTET STRING { OCTET STRING[32] } }
const PKCS8_ED25519_PREFIX = new Uint8Array([
    0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
])

const ED25519_SEED_BYTES = 32

export interface ZooEmbedSigningConfig {
    /** Zoo's origin, with or without a scheme (`zoo.example` / `https://zoo.example`). */
    host: string
    /** Our key id, as registered with Zoo. */
    kid: string
    /** The 32-byte Ed25519 seed, base64url. A SECRET: server-side only. */
    privateSeedB64Url: string
}

export class ZooEmbedUrlSigner implements EmbedUrlSigner {
    readonly kid: string
    private readonly origin: string
    private readonly seedB64Url: string
    /** The imported key, memoised per instance: importKey is not free and the
     *  key never changes. Held as the promise so concurrent first calls in one
     *  request share a single import. */
    private key: Promise<CryptoKey> | null = null

    constructor(config: ZooEmbedSigningConfig, private readonly clock: Clock) {
        if (!isValidKid(config.kid)) throw new Error(`ZOO_EMBED_KID is not a valid kid: ${JSON.stringify(config.kid)}`)
        this.kid = config.kid
        this.seedB64Url = config.privateSeedB64Url
        this.origin = normaliseOrigin(config.host)
    }

    async sign(embedId: string, format: EmbedFormat = "webp"): Promise<string> {
        const id = EmbedId.parse(embedId)
        if (!id) throw new Error(`not a valid embed id: ${JSON.stringify(embedId)}`)

        const exp = embedExpiry(Math.floor(this.clock.now().getTime() / 1000))
        const payload = embedSigningPayload(id.value, exp, this.kid)
        const sig = new Uint8Array(
            await crypto.subtle.sign("Ed25519", await this.signingKey(), new TextEncoder().encode(payload)),
        )

        const query = new URLSearchParams({ kid: this.kid, exp: String(exp), sig: bytesToBase64Url(sig) })
        return `${this.origin}/e/${id.value}.${format}?${query}`
    }

    private signingKey(): Promise<CryptoKey> {
        // A bad seed is a deployment error, not a transient one, so a rejected
        // import stays cached and every call fails the same loud way.
        this.key ??= (async () => {
            const seed = base64UrlToBytes(this.seedB64Url)
            if (seed.length !== ED25519_SEED_BYTES) {
                throw new Error(`ZOO_EMBED_PRIVATE_KEY must decode to ${ED25519_SEED_BYTES} bytes, got ${seed.length}`)
            }
            const pkcs8 = new Uint8Array(PKCS8_ED25519_PREFIX.length + ED25519_SEED_BYTES)
            pkcs8.set(PKCS8_ED25519_PREFIX, 0)
            pkcs8.set(seed, PKCS8_ED25519_PREFIX.length)
            // extractable: false — the key cannot be read back out, only used.
            return crypto.subtle.importKey("pkcs8", pkcs8, { name: "Ed25519" }, false, ["sign"])
        })()
        return this.key
    }
}

/** `zoo.example` and `https://zoo.example/` both normalise to `https://zoo.example`. */
function normaliseOrigin(host: string): string {
    const withScheme = /^https?:\/\//i.test(host) ? host : `https://${host}`
    return withScheme.replace(/\/+$/, "")
}

function base64UrlToBytes(value: string): Uint8Array {
    const base64 = value.replace(/-/g, "+").replace(/_/g, "/")
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4)
    const binary = atob(padded)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
}

/** base64url, unpadded — what Zoo parses the `sig` parameter as. */
function bytesToBase64Url(bytes: Uint8Array): string {
    let binary = ""
    for (const byte of bytes) binary += String.fromCharCode(byte)
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}
