// GitHub App ("Bobby") authentication + REST helpers.
//
// Server-only. ALL crypto goes through Web Crypto (`crypto.subtle`) because
// this runs on Cloudflare Workers where node:crypto is unreliable for signing.
// RS256 for the app JWT, HMAC-SHA256 for webhook-signature verification.
//
// Installation access tokens are cached in tracker.github_installations
// (cached_token / token_expires_at) — strongly consistent, no KV needed.
// See plan Phase 2 + the shared contract for exact signatures.

import { createServiceClient } from "@/lib/supabase/server"

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

// ─── base64 / base64url helpers ─────────────────────────────────────────────

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
    const bin = atob(b64)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
}

function bytesToBase64url(bytes: Uint8Array): string {
    let bin = ""
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function stringToBase64url(s: string): string {
    return bytesToBase64url(new TextEncoder().encode(s))
}

function bytesToHex(bytes: Uint8Array): string {
    let hex = ""
    for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, "0")
    return hex
}

// DER length octets (short form < 128, else long form).
function derLen(n: number): number[] {
    if (n < 0x80) return [n]
    const out: number[] = []
    let v = n
    while (v > 0) {
        out.unshift(v & 0xff)
        v >>= 8
    }
    return [0x80 | out.length, ...out]
}

// GitHub App private keys download in PKCS#1 ("BEGIN RSA PRIVATE KEY"), but
// Web Crypto's importKey only accepts PKCS#8 ("BEGIN PRIVATE KEY"). Wrap the
// PKCS#1 RSAPrivateKey DER in a PKCS#8 PrivateKeyInfo so it imports cleanly.
function pkcs1ToPkcs8(pkcs1: Uint8Array): Uint8Array<ArrayBuffer> {
    // AlgorithmIdentifier { OID 1.2.840.113549.1.1.1 (rsaEncryption), NULL }.
    const rsaAlgId = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00]
    const version = [0x02, 0x01, 0x00]
    const pk = Array.from(pkcs1)
    const octet = [0x04, ...derLen(pk.length), ...pk] // OCTET STRING { pkcs1 }
    const body = [...version, ...rsaAlgId, ...octet]
    return new Uint8Array([0x30, ...derLen(body.length), ...body]) // SEQUENCE
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

// Constant-time compare of two equal-length hex strings. Fixed-length XOR
// accumulate so timing doesn't leak where the first mismatch is. Different
// lengths short-circuit to false (a length difference isn't a secret).
function timingSafeHexEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false
    let diff = 0
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
    return diff === 0
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

// ─── Thin REST helpers ──────────────────────────────────────────────────────

async function readError(res: Response, action: string): Promise<never> {
    const detail = await res.text().catch(() => "")
    throw new Error(`github: ${action} failed (${res.status}): ${detail.slice(0, 300)}`)
}

// createGithubIssue opens an issue and returns its number + node_id.
export async function createGithubIssue(
    installationId: number,
    owner: string,
    repo: string,
    data: { title: string; body?: string },
): Promise<{ number: number; node_id: string }> {
    const res = await githubAppFetch(installationId, `/repos/${owner}/${repo}/issues`, {
        method: "POST",
        body: JSON.stringify({ title: data.title, body: data.body ?? "" }),
    })
    if (!res.ok) return readError(res, "create issue")
    const body = (await res.json()) as { number: number; node_id: string }
    return { number: body.number, node_id: body.node_id }
}

// updateGithubIssue patches an existing issue's title/body/state.
export async function updateGithubIssue(
    installationId: number,
    owner: string,
    repo: string,
    num: number,
    patch: { title?: string; body?: string; state?: "open" | "closed" },
): Promise<void> {
    const res = await githubAppFetch(installationId, `/repos/${owner}/${repo}/issues/${num}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
    })
    if (!res.ok) return readError(res, "update issue")
}

// createIssueComment posts a comment (as the bot) on an issue and returns its
// id so the caller can later edit it in place (loading → result).
export async function createIssueComment(
    installationId: number,
    owner: string,
    repo: string,
    num: number,
    body: string,
): Promise<{ id: number }> {
    const res = await githubAppFetch(
        installationId,
        `/repos/${owner}/${repo}/issues/${num}/comments`,
        { method: "POST", body: JSON.stringify({ body }) },
    )
    if (!res.ok) return readError(res, "create comment")
    const b = (await res.json()) as { id: number }
    return { id: b.id }
}

// updateIssueComment edits an existing comment in place (by comment id) — used
// to swap the "analysing…" placeholder for the final result.
export async function updateIssueComment(
    installationId: number,
    owner: string,
    repo: string,
    commentId: number,
    body: string,
): Promise<void> {
    const res = await githubAppFetch(
        installationId,
        `/repos/${owner}/${repo}/issues/comments/${commentId}`,
        { method: "PATCH", body: JSON.stringify({ body }) },
    )
    if (!res.ok) return readError(res, "update comment")
}

// deleteIssueGraphQL hard-deletes an issue via the GraphQL deleteIssue mutation
// (the REST API can't delete issues). Needs the issue node id. Returns true on
// success; false (rather than throwing) when the org/app can't delete, so the
// caller can fall back to closing.
export async function deleteIssueGraphQL(installationId: number, issueNodeId: string): Promise<boolean> {
    const query = "mutation($id: ID!) { deleteIssue(input: { issueId: $id }) { clientMutationId } }"
    const res = await githubAppFetch(installationId, "https://api.github.com/graphql", {
        method: "POST",
        body: JSON.stringify({ query, variables: { id: issueNodeId } }),
    })
    if (!res.ok) return false
    const body = (await res.json().catch(() => null)) as { errors?: unknown[] } | null
    return !!body && !(Array.isArray(body.errors) && body.errors.length > 0)
}

// GithubRepoIssue is the subset of a REST issue we care about for backfill.
export interface GithubRepoIssue {
    number: number
    node_id: string
    title: string
    body: string | null
    state: string // "open" | "closed"
}

// listRepoIssues paginates the repo's issues (state=all by default). The REST
// issues endpoint also returns PRs — those carry a `pull_request` field and are
// filtered out. Bounded by maxPages (×100) so a huge repo can't run unbounded.
export async function listRepoIssues(
    installationId: number,
    owner: string,
    repo: string,
    opts: { state?: "open" | "closed" | "all"; maxPages?: number } = {},
): Promise<GithubRepoIssue[]> {
    const state = opts.state ?? "all"
    const maxPages = opts.maxPages ?? 10 // up to 1000 issues
    const out: GithubRepoIssue[] = []
    for (let page = 1; page <= maxPages; page++) {
        const res = await githubAppFetch(
            installationId,
            `/repos/${owner}/${repo}/issues?state=${state}&per_page=100&page=${page}`,
        )
        if (!res.ok) return readError(res, "list issues")
        const items = (await res.json().catch(() => [])) as Array<
            GithubRepoIssue & { pull_request?: unknown }
        >
        if (!Array.isArray(items) || items.length === 0) break
        for (const it of items) {
            if (it.pull_request) continue // skip PRs
            out.push({ number: it.number, node_id: it.node_id, title: it.title, body: it.body ?? null, state: it.state })
        }
        if (items.length < 100) break
    }
    return out
}

// GithubPRFile is the subset of a PR's changed-file entry we send to the
// analyser (GET /repos/{o}/{r}/pulls/{n}/files).
export interface GithubPRFile {
    filename: string
    previous_filename?: string
    status: string // added | modified | removed | renamed | changed
    patch?: string // unified diff; absent for binary/oversized files
    additions: number
    deletions: number
}

// listPullRequestFiles fetches a PR's changed files (with per-file unified
// patches), paginated. Bounded by maxPages × 100 so a huge PR can't run
// unbounded.
export async function listPullRequestFiles(
    installationId: number,
    owner: string,
    repo: string,
    number: number,
    opts: { maxPages?: number } = {},
): Promise<GithubPRFile[]> {
    const maxPages = opts.maxPages ?? 5 // up to 500 files
    const out: GithubPRFile[] = []
    for (let page = 1; page <= maxPages; page++) {
        const res = await githubAppFetch(
            installationId,
            `/repos/${owner}/${repo}/pulls/${number}/files?per_page=100&page=${page}`,
        )
        if (!res.ok) return readError(res, "list PR files")
        const items = (await res.json().catch(() => [])) as GithubPRFile[]
        if (!Array.isArray(items) || items.length === 0) break
        out.push(...items)
        if (items.length < 100) break
    }
    return out
}
