// Repo-scoped bearer tokens for Zoo's server-to-server APIs.
//
// The catalogue and the mint endpoint are ordinary HTTPS calls, so unlike an
// <img> they can carry a header — no signature in the URL. They reuse the SAME
// Ed25519 key as embed URLs (one key to distribute, one `kid` to rotate) but
// distinct, repo-scoped payloads:
//
//     v1.catalogue.<sha256hex(repoKey)>.<exp>.<kid>     read
//     v1.mint.<sha256hex(repoKey)>.<exp>.<kid>          write (costs a render)
//
// Two consequences worth stating, because both are load-bearing:
//   · the SCOPE means a leaked read token cannot buy a render, and neither can
//     be replayed as an image-URL signature;
//   · the REPO binding means a token for one project cannot read or mint
//     another's, which is what lets us hand Zoo one key for all our projects.
//
// The repo key is HASHED into the payload because repo keys contain dots
// (`github.com/acme/widgets`) and the payload is dot-joined — an unhashed key
// would make the join ambiguous. Zoo hashes identically; the two must agree.

import { isValidKid } from "../domain/EmbedSignature"
import type { Clock } from "@/lib/shared/kernel"

/** Zoo clamps a bearer token's life to the same ceiling as an embed URL. Short
 *  on purpose: unlike an image URL there is nothing to cache, so there is no
 *  reason to hand out a long-lived credential. */
const TOKEN_TTL_SECONDS = 300

export type ZooTokenScope = "catalogue" | "mint"

export class ZooRepoTokens {
    constructor(
        private readonly config: { kid: string; privateSeedB64Url: string },
        private readonly clock: Clock,
    ) {
        if (!isValidKid(config.kid)) throw new Error(`ZOO_EMBED_KID is not a valid kid: ${config.kid}`)
    }

    /** A bearer token for `scope`, bound to `repoKey` AND to the tenant we are
     *  acting for.
     *
     *  The tenant binding is what makes Zoo's consent meaningful: every one of
     *  our projects signs with the SAME key, so without it a grant made by one
     *  Zoo user would open their repo to every project in this deployment. Zoo
     *  records consent per (kid, subject, repo) and checks all three. */
    async bearer(scope: ZooTokenScope, repoKey: string, subject: string): Promise<string> {
        const exp = Math.floor(this.clock.now().getTime() / 1000) + TOKEN_TTL_SECONDS
        const scopeHash = await sha256Hex(repoKey)
        const subjectHash = await sha256Hex(subject)
        const payload = `v1.${scope}.${scopeHash}.${subjectHash}.${exp}.${this.config.kid}`
        const sig = new Uint8Array(
            await crypto.subtle.sign("Ed25519", await this.key(), new TextEncoder().encode(payload)),
        )
        // Self-describing, so Zoo needs no out-of-band parameters to verify.
        return `v1.${exp}.${this.config.kid}.${bytesToBase64Url(sig)}`
    }

    private keyPromise: Promise<CryptoKey> | null = null

    private key(): Promise<CryptoKey> {
        this.keyPromise ??= importEd25519Seed(this.config.privateSeedB64Url)
        return this.keyPromise
    }
}

// The PKCS#8 wrapper for a raw Ed25519 seed — Web Crypto offers no raw-seed
// import. Same constant as the URL signer; kept local so neither file has to
// import the other's internals.
const PKCS8_ED25519_PREFIX = new Uint8Array([
    0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
])

async function importEd25519Seed(seedB64Url: string): Promise<CryptoKey> {
    const seed = base64UrlToBytes(seedB64Url)
    if (seed.length !== 32) throw new Error(`ZOO_EMBED_PRIVATE_KEY must decode to 32 bytes, got ${seed.length}`)
    const pkcs8 = new Uint8Array(PKCS8_ED25519_PREFIX.length + 32)
    pkcs8.set(PKCS8_ED25519_PREFIX, 0)
    pkcs8.set(seed, PKCS8_ED25519_PREFIX.length)
    return crypto.subtle.importKey("pkcs8", pkcs8, { name: "Ed25519" }, false, ["sign"])
}

async function sha256Hex(value: string): Promise<string> {
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))
    let hex = ""
    for (const byte of digest) hex += byte.toString(16).padStart(2, "0")
    return hex
}

function base64UrlToBytes(value: string): Uint8Array {
    const base64 = value.replace(/-/g, "+").replace(/_/g, "/")
    const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4))
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
}

function bytesToBase64Url(bytes: Uint8Array): string {
    let binary = ""
    for (const byte of bytes) binary += String.fromCharCode(byte)
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}
