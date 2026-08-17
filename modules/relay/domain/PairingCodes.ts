// Generates and normalises the codes used during relay device pairing. Pure —
// crypto-random value production, no I/O.

import { randomBytes } from "crypto"

// Crockford-ish alphabet with ambiguous glyphs (0/O, 1/I/L) removed so a user can
// read a code off the relay window and type it without misreads.
const USER_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

// 10 chars over the 31-symbol alphabet is ~50 bits of entropy; with the 10-min
// expiry, single-use, and per-IP rate limit, online brute force is out of reach.
// Keep in sync with the client formatter in components/relay/relay-pair-approve.tsx.
const USER_CODE_LEN = 10

export class PairingCodes {
    /** base64url of 32 random bytes — the relay's polling secret. */
    deviceCode(): string {
        return randomBytes(32).toString("base64url")
    }

    /** 10 chars from the unambiguous alphabet, formatted "XXXXX-XXXXX". */
    userCode(): string {
        const buf = randomBytes(USER_CODE_LEN)
        let out = ""
        for (let i = 0; i < USER_CODE_LEN; i++) out += USER_CODE_ALPHABET[buf[i] % USER_CODE_ALPHABET.length]
        return `${out.slice(0, USER_CODE_LEN / 2)}-${out.slice(USER_CODE_LEN / 2)}`
    }

    /** Opaque worker bearer token the relay presents to the analyser. */
    token(): string {
        return randomBytes(32).toString("base64url")
    }

    /** Normalise a user-entered code: drop dashes/spaces, uppercase, so approve/deny
     *  match regardless of how it was typed. */
    normalize(code: string): string {
        return code.replace(/[\s-]/g, "").toUpperCase()
    }
}
