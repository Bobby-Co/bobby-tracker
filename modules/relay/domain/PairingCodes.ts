// Relay domain — pairing code/token value helpers. Pure generators + the
// normaliser used during device pairing (see the relay route handlers under
// app/api/relay/). No IO, no DB, no network: crypto-random value production is a
// domain concern owned by this concept file (the vcs SyncHash/RepoRef precedent —
// pure value helpers stay functions in a well-named file, no ceremony class).

import { randomBytes } from "crypto"

// Crockford-ish alphabet with ambiguous glyphs (0/O, 1/I/L) removed so a
// user can read a code off the relay window and type it without misreads.
const USER_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

// Number of significant characters in a user code. 10 chars over the 31-symbol
// alphabet is ~50 bits of entropy. Combined with the 10-minute expiry, the
// single-use consumption, and the per-IP rate limit on approve/deny, this puts
// online brute force far out of reach. Keep CODE_LEN in sync with the client
// formatter in components/relay-pair-approve.tsx.
export const USER_CODE_LEN = 10

// base64url of 32 random bytes — the relay's polling secret.
export function genDeviceCode(): string {
    return randomBytes(32).toString("base64url")
}

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
