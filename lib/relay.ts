// Server-side helpers for the bobby-relay device-pairing + worker
// management feature. A "worker" is a user's local machine that exposes
// a local LLM to the bobby-analyser server (see the relay route handlers
// under app/api/relay/). This module owns the wire types shared with the
// workers UI, the random-code generators used during pairing, and the
// best-effort liveness lookup against the analyser.
//
// Backed by tracker.relay_workers + tracker.relay_pairings
// (supabase/migrations/0033_relay_workers.sql).

import { randomBytes } from "crypto"

// ─── wire types (shared with app/(app)/workers UI) ─────────────────────────

export interface RelayModel {
    id: string
    supportsTools?: boolean
    contextWindow?: number
}

export interface RelayWorker {
    id: string
    name: string
    endpoint: string | null
    models: RelayModel[]
    createdAt: string
    lastSeenAt: string | null
    /** True when the analyser currently has a live connection from this
     *  worker. Derived from fetchAnalyserWorkers(), defaults false. */
    online: boolean
    /** When the live connection was established, per the analyser. */
    connectedSince: string | null
}

export interface PairingStartResult {
    deviceCode: string
    userCode: string
    pairUrl: string
    interval: number
    expiresIn: number
}

// ─── code / token generators ────────────────────────────────────────────────

// Crockford-ish alphabet with ambiguous glyphs (0/O, 1/I/L) removed so a
// user can read a code off the relay window and type it without misreads.
const USER_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

// base64url of 32 random bytes — the relay's polling secret.
export function genDeviceCode(): string {
    return randomBytes(32).toString("base64url")
}

// Number of significant characters in a user code. 10 chars over the 31-symbol
// alphabet is ~50 bits of entropy. Combined with the 10-minute expiry, the
// single-use consumption, and the per-IP rate limit on approve/deny, this puts
// online brute force far out of reach. Keep CODE_LEN in sync with the client
// formatter in components/relay-pair-approve.tsx.
export const USER_CODE_LEN = 10

// 10 chars from the unambiguous alphabet, formatted "XXXXX-XXXXX" for the
// user to read aloud / type while signed into the tracker.
export function genUserCode(): string {
    const buf = randomBytes(USER_CODE_LEN)
    let out = ""
    for (let i = 0; i < USER_CODE_LEN; i++) {
        out += USER_CODE_ALPHABET[buf[i] % USER_CODE_ALPHABET.length]
    }
    const half = USER_CODE_LEN / 2
    return `${out.slice(0, half)}-${out.slice(half)}`
}

// base64url of 32 random bytes — the opaque worker bearer token the relay
// presents to the analyser, resolved back to a userId via /relay/resolve.
export function genToken(): string {
    return randomBytes(32).toString("base64url")
}

// Normalize a user-entered code: drop dashes/spaces, uppercase. Lets the
// approve/deny endpoints match regardless of how the user typed it.
export function normalizeUserCode(code: string): string {
    return code.replace(/[\s-]/g, "").toUpperCase()
}

// ─── analyser liveness lookup ───────────────────────────────────────────────

const ANALYSER_URL = process.env.BOBBY_ANALYSER_URL || ""
const ANALYSER_TOKEN = process.env.BOBBY_ANALYSER_TOKEN || ""

/** Live-connection info the analyser reports for one worker. */
export interface AnalyserWorker {
    userId: string
    workerId?: string
    endpoint?: string
    models?: RelayModel[]
    connectedSince?: string
}

/** A live worker keyed by both workerId (preferred, when present) and
 *  userId (fallback). Callers match a DB row against either. */
export interface AnalyserWorkers {
    byWorkerId: Map<string, AnalyserWorker>
    byUserId: Map<string, AnalyserWorker>
}

// fetchAnalyserWorkers asks the analyser which workers are currently
// connected. Best-effort: any error / timeout / missing config degrades to
// empty maps (the UI then just shows every worker offline). 2s timeout.
export async function fetchAnalyserWorkers(): Promise<AnalyserWorkers> {
    const empty: AnalyserWorkers = { byWorkerId: new Map(), byUserId: new Map() }
    if (!ANALYSER_URL) return empty

    const http = ANALYSER_URL.replace(/\/+$/, "")
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 2000)
    try {
        const res = await fetch(`${http}/relay/workers`, {
            method: "GET",
            headers: ANALYSER_TOKEN ? { Authorization: `Bearer ${ANALYSER_TOKEN}` } : {},
            signal: controller.signal,
        })
        if (!res.ok) return empty
        const body = (await res.json()) as { workers?: AnalyserWorker[] }
        const workers = Array.isArray(body?.workers) ? body.workers : []
        for (const w of workers) {
            if (!w || typeof w.userId !== "string") continue
            empty.byUserId.set(w.userId, w)
            if (typeof w.workerId === "string" && w.workerId) {
                empty.byWorkerId.set(w.workerId, w)
            }
        }
        return empty
    } catch {
        // Network error, timeout (abort), or malformed body — degrade.
        return empty
    } finally {
        clearTimeout(timer)
    }
}
