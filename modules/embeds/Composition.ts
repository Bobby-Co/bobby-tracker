// Embeds module — composition root. The ONE place that reads the signing key
// out of the environment and builds a signer from it.
//
// Everything above this file depends on the EmbedUrlSigner port, so the key has
// exactly one path into the process, and that path is server-only: this file
// imports the kernel's Workers adapters, so a client bundle that reached for it
// would fail to build rather than ship a secret. Client components import from
// `modules/embeds/domain/*` instead — pure types and the `zoo:` scheme, nothing
// that can sign.
//
// A missing/incomplete configuration returns null rather than throwing: an
// unconfigured deployment renders issues with embed placeholders, it does not
// fail to render issues.

import { systemClock } from "@/lib/shared/kernel/adapters"
import { ComponentPickerService } from "./application/ComponentPickerService"
import { EmbedSigningService } from "./application/EmbedSigningService"
import { ZooEmbedMetadataSource } from "./infrastructure/ZooEmbedMetadataSource"
import { ZooComponentCatalog } from "./infrastructure/ZooComponentCatalog"
import { ZooEmbedMinter } from "./infrastructure/ZooEmbedMinter"
import { ZooRepoTokens } from "./infrastructure/ZooRepoTokens"
import { ZooEmbedUrlSigner } from "./infrastructure/ZooEmbedUrlSigner"
import type { EmbedUrlSigner } from "./ports/EmbedUrlSigner"

/** Memoised per configuration. The point is the imported CryptoKey inside the
 *  signer: rebuilding it per request would re-run importKey on every issue
 *  page, and the metadata cache would never survive to be used. Keyed by the
 *  config so a secret rotated under a running isolate takes effect. */
let cached: { fingerprint: string; service: EmbedSigningService } | null = null

interface EmbedEnv {
    host: string
    kid: string
    seed: string
}

function readEnv(): EmbedEnv | null {
    const host = process.env.ZOO_EMBED_HOST?.trim() || ""
    const kid = process.env.ZOO_EMBED_KID?.trim() || ""
    const seed = process.env.ZOO_EMBED_PRIVATE_KEY?.trim() || ""
    if (!host || !kid || !seed) return null
    return { host, kid, seed }
}

/** The signer for this deployment, or null when embeds aren't configured. */
export function resolveEmbedUrlSigner(): EmbedUrlSigner | null {
    const env = readEnv()
    if (!env) return null
    return new ZooEmbedUrlSigner({ host: env.host, kid: env.kid, privateSeedB64Url: env.seed }, systemClock)
}

/** The service a page/route uses AFTER its own access check has passed.
 *  Null when embeds aren't configured — callers treat that as "no embeds". */
export function getEmbedSigningService(): EmbedSigningService | null {
    const env = readEnv()
    if (!env) return null

    // Not the seed itself — a fingerprint only, so a stack trace or a debugger
    // snapshot of this module never carries the key.
    const fingerprint = `${env.host}|${env.kid}|${env.seed.length}|${env.seed.slice(0, 4)}`
    if (cached?.fingerprint === fingerprint) return cached.service

    const signer = new ZooEmbedUrlSigner(
        { host: env.host, kid: env.kid, privateSeedB64Url: env.seed },
        systemClock,
    )
    const service = new EmbedSigningService(signer, new ZooEmbedMetadataSource(signer, systemClock))
    cached = { fingerprint, service }
    return service
}

/** The picker's service, or null when embeds aren't configured.
 *
 *  Reads Zoo's real component catalogue and mints through Zoo's own API — both
 *  authenticated with the SAME key as embed URLs, under distinct repo-scoped
 *  bearer tokens (see ZooRepoTokens). */
export function getComponentPickerService(): ComponentPickerService | null {
    const env = readEnv()
    const signing = getEmbedSigningService()
    if (!env || !signing) return null

    const origin = normaliseOrigin(env.host)
    const tokens = new ZooRepoTokens({ kid: env.kid, privateSeedB64Url: env.seed }, systemClock)
    // One adapter implements both roles — the catalogue and its thumbnails are
    // the same endpoint family behind the same token scope.
    const catalog = new ZooComponentCatalog(origin, tokens)
    return new ComponentPickerService(catalog, new ZooEmbedMinter(origin, tokens), signing, catalog, {
        origin,
        kid: env.kid,
        appName: "Bobby Tracker",
    })
}

/** `zoo.example` and `https://zoo.example/` both normalise to `https://zoo.example`. */
function normaliseOrigin(host: string): string {
    const withScheme = /^https?:\/\//i.test(host) ? host : `https://${host}`
    return withScheme.replace(/\/+$/, "")
}
