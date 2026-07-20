// Pure crypto/encoding helpers extracted from lib/github-app.ts (Phase 3
// god-module split). No I/O, no module state — just byte/DER/base64/hex
// transforms and a constant-time compare. Safe to import anywhere.

// ─── base64 / base64url helpers ─────────────────────────────────────────────

export function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
    const bin = atob(b64)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
}

export function bytesToBase64url(bytes: Uint8Array): string {
    let bin = ""
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

export function stringToBase64url(s: string): string {
    return bytesToBase64url(new TextEncoder().encode(s))
}

export function bytesToHex(bytes: Uint8Array): string {
    let hex = ""
    for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, "0")
    return hex
}

// DER length octets (short form < 128, else long form).
export function derLen(n: number): number[] {
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
export function pkcs1ToPkcs8(pkcs1: Uint8Array): Uint8Array<ArrayBuffer> {
    // AlgorithmIdentifier { OID 1.2.840.113549.1.1.1 (rsaEncryption), NULL }.
    const rsaAlgId = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00]
    const version = [0x02, 0x01, 0x00]
    const pk = Array.from(pkcs1)
    const octet = [0x04, ...derLen(pk.length), ...pk] // OCTET STRING { pkcs1 }
    const body = [...version, ...rsaAlgId, ...octet]
    return new Uint8Array([0x30, ...derLen(body.length), ...body]) // SEQUENCE
}

// ─── constant-time compare ──────────────────────────────────────────────────

// Constant-time compare of two equal-length hex strings. Fixed-length XOR
// accumulate so timing doesn't leak where the first mismatch is. Different
// lengths short-circuit to false (a length difference isn't a secret).
export function timingSafeHexEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false
    let diff = 0
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
    return diff === 0
}
