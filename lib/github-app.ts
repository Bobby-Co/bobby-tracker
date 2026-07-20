// GitHub App ("Bobby") authentication core — JWT minting, installation-token
// caching, the choke-point fetch, and webhook-signature verification.
//
// The thin REST helpers (issues/PRs/comments/reviews/merge) that compose on top
// of githubAppFetch now live in lib/github-app-rest.ts; this file holds only the
// auth/transport primitives they build on.
//
// Server-only. ALL crypto goes through Web Crypto (`crypto.subtle`) because
// this runs on Cloudflare Workers where node:crypto is unreliable for signing.
// RS256 for the app JWT, HMAC-SHA256 for webhook-signature verification.
//
// Installation access tokens are cached in tracker.github_installations
// (cached_token / token_expires_at) — strongly consistent, no KV needed.
// See plan Phase 2 + the shared contract for exact signatures.

import { createServiceClient } from "@/lib/supabase/server"
import {
    base64ToBytes,
    bytesToBase64url,
    bytesToHex,
    pkcs1ToPkcs8,
    stringToBase64url,
    timingSafeHexEqual,
} from "./github-app-crypto"

const GITHUB_API = "https://api.github.com"
const USER_AGENT = "ucelot-tracker"

// Mandatory header set for every GitHub REST call. Cloudflare's fetch adds no
// default User-Agent (GitHub 403s without one) — mirror app/api/github/repos.
function githubHeaders(token: string): Record<string, string> {
    return {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": USER_AGENT,
    }
}

// ─── App private key (RS256) ────────────────────────────────────────────────

// GITHUB_APP_PRIVATE_KEY is a PKCS8 PEM, base64-encoded when stored (secret
// storage mangles PEM newlines). Decode the wrapper, strip the PEM armor, then
// base64-decode the DER body and import as an RSASSA-PKCS1-v1_5 signing key.
let appKeyPromise: Promise<CryptoKey> | null = null

function importAppPrivateKey(): Promise<CryptoKey> {
    if (appKeyPromise) return appKeyPromise
    appKeyPromise = (async () => {
        const raw = process.env.GITHUB_APP_PRIVATE_KEY
        if (!raw) throw new Error("GITHUB_APP_PRIVATE_KEY is not set")
        // Accept either a base64-wrapped PEM (recommended — survives secret
        // storage) or a raw PEM pasted directly.
        const pem = raw.includes("BEGIN") ? raw : new TextDecoder().decode(base64ToBytes(raw.trim()))
        // GitHub ships PKCS#1 ("BEGIN RSA PRIVATE KEY"); Web Crypto needs PKCS#8.
        const isPkcs1 = /BEGIN RSA PRIVATE KEY/.test(pem)
        const der = base64ToBytes(
            pem
                .replace(/-----BEGIN [^-]+-----/, "")
                .replace(/-----END [^-]+-----/, "")
                .replace(/\s+/g, ""),
        )
        const keyData = isPkcs1 ? pkcs1ToPkcs8(der) : der
        return crypto.subtle.importKey(
            "pkcs8",
            keyData,
            { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
            false,
            ["sign"],
        )
    })().catch((e) => {
        // Don't memoize a failed import — a later call (e.g. after the secret
        // is configured) should retry.
        appKeyPromise = null
        throw e
    })
    return appKeyPromise
}

// mintAppJwt builds and RS256-signs a short-lived app JWT (GitHub caps exp at
// 10 min; iat is backdated 60s to tolerate clock skew).
export async function mintAppJwt(): Promise<string> {
    const appId = process.env.GITHUB_APP_ID
    if (!appId) throw new Error("GITHUB_APP_ID is not set")

    const now = Math.floor(Date.now() / 1000)
    const header = { alg: "RS256", typ: "JWT" }
    const claims = { iat: now - 60, exp: now + 600, iss: appId }
    const signingInput = `${stringToBase64url(JSON.stringify(header))}.${stringToBase64url(
        JSON.stringify(claims),
    )}`

    const key = await importAppPrivateKey()
    const sig = new Uint8Array(
        await crypto.subtle.sign(
            "RSASSA-PKCS1-v1_5",
            key,
            new TextEncoder().encode(signingInput),
        ),
    )
    return `${signingInput}.${bytesToBase64url(sig)}`
}

// ─── Installation access tokens (DB-cached) ─────────────────────────────────

// Per-isolate memo so a burst of calls within one request mints at most once.
const inflightTokens = new Map<number, Promise<string>>()

// getInstallationToken returns a valid installation token, reusing the cached
// one in github_installations when it has >5 min of life left, else minting a
// fresh one via the app JWT and storing it back (service-role).
export async function getInstallationToken(installationId: number): Promise<string> {
    const existing = inflightTokens.get(installationId)
    if (existing) return existing

    const p = (async () => {
        const svc = createServiceClient()
        const { data: row } = await svc
            .from("github_installations")
            .select("cached_token,token_expires_at")
            .eq("installation_id", installationId)
            .maybeSingle<{ cached_token: string | null; token_expires_at: string | null }>()

        // 5-minute safety margin so a token doesn't expire mid-flight.
        const marginMs = 5 * 60 * 1000
        if (row?.cached_token && row.token_expires_at) {
            const expMs = Date.parse(row.token_expires_at)
            if (Number.isFinite(expMs) && expMs - Date.now() > marginMs) {
                return row.cached_token
            }
        }

        const { token, expiresAt } = await mintInstallationToken(installationId)
        await svc
            .from("github_installations")
            .update({ cached_token: token, token_expires_at: expiresAt })
            .eq("installation_id", installationId)
        return token
    })()

    inflightTokens.set(installationId, p)
    try {
        return await p
    } finally {
        inflightTokens.delete(installationId)
    }
}

async function mintInstallationToken(
    installationId: number,
): Promise<{ token: string; expiresAt: string }> {
    const jwt = await mintAppJwt()
    const res = await fetch(`${GITHUB_API}/app/installations/${installationId}/access_tokens`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${jwt}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": USER_AGENT,
        },
    })
    if (!res.ok) {
        const detail = await res.text().catch(() => "")
        throw new Error(
            `github: mint installation token failed (${res.status}): ${detail.slice(0, 300)}`,
        )
    }
    const body = (await res.json()) as { token: string; expires_at: string }
    return { token: body.token, expiresAt: body.expires_at }
}

// evictInstallationToken clears the DB cache so the next getInstallationToken
// re-mints. Used on a 401 from githubAppFetch.
async function evictInstallationToken(installationId: number): Promise<void> {
    inflightTokens.delete(installationId)
    const svc = createServiceClient()
    await svc
        .from("github_installations")
        .update({ cached_token: null, token_expires_at: null })
        .eq("installation_id", installationId)
}

// ─── Choke-point fetch ──────────────────────────────────────────────────────

// githubAppFetch is the single entry point for installation-scoped REST calls.
// It attaches the installation token + mandatory headers, and on a 401
// (token revoked/rotated) evicts the cache and re-mints exactly once.
export async function githubAppFetch(
    installationId: number,
    path: string,
    init: RequestInit = {},
): Promise<Response> {
    const url = path.startsWith("http") ? path : `${GITHUB_API}${path}`

    const doFetch = async (token: string): Promise<Response> =>
        fetch(url, {
            ...init,
            headers: { ...githubHeaders(token), ...(init.headers as Record<string, string>) },
            cache: "no-store",
        })

    let token = await getInstallationToken(installationId)
    let res = await doFetch(token)
    if (res.status === 401) {
        // Stale token — force a fresh mint and retry once.
        await evictInstallationToken(installationId)
        token = await getInstallationToken(installationId)
        res = await doFetch(token)
    }
    return res
}

// githubJwtFetch calls an APP-level endpoint authenticated with the app JWT
// (no installation token needed). Used to resolve which installation covers a
// repo — GET /repos/{owner}/{repo}/installation — so we can link an already-
// installed app to a project without waiting on the install redirect.
export async function githubJwtFetch(path: string, init: RequestInit = {}): Promise<Response> {
    const jwt = await mintAppJwt()
    const url = path.startsWith("http") ? path : `${GITHUB_API}${path}`
    return fetch(url, {
        ...init,
        headers: {
            Authorization: `Bearer ${jwt}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": USER_AGENT,
            ...(init.headers as Record<string, string>),
        },
        cache: "no-store",
    })
}

// ─── Webhook signature verification ─────────────────────────────────────────

let webhookKeyPromise: Promise<CryptoKey> | null = null

function importWebhookKey(): Promise<CryptoKey> {
    if (webhookKeyPromise) return webhookKeyPromise
    webhookKeyPromise = (async () => {
        const secret = process.env.GITHUB_APP_WEBHOOK_SECRET
        if (!secret) throw new Error("GITHUB_APP_WEBHOOK_SECRET is not set")
        return crypto.subtle.importKey(
            "raw",
            new TextEncoder().encode(secret),
            { name: "HMAC", hash: "SHA-256" },
            false,
            ["sign"],
        )
    })().catch((e) => {
        webhookKeyPromise = null
        throw e
    })
    return webhookKeyPromise
}

// verifyWebhookSignature HMAC-SHA256s the raw request body and compares (in
// constant time) against the "sha256=<hex>" x-hub-signature-256 header. Never
// uses ===. Returns false for a missing/malformed header rather than throwing.
export async function verifyWebhookSignature(
    rawBody: string,
    signature: string | null,
): Promise<boolean> {
    if (!signature || !signature.startsWith("sha256=")) return false
    const expected = signature.slice("sha256=".length)

    const key = await importWebhookKey()
    const mac = new Uint8Array(
        await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody)),
    )
    return timingSafeHexEqual(bytesToHex(mac), expected)
}
