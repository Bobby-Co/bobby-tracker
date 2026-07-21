// VCS domain — the content-hash echo-suppression primitive. syncHash is the
// loop-guard fingerprint: it MUST be computed identically on both sides of the
// sync so an inbound webhook that echoes our own outbound write hashes to the
// value we already stored in last_synced_hash and gets dropped.
//
// Pure domain: uses the Web Crypto global (crypto.subtle) — a runtime primitive,
// not an SDK/framework import — so it stays runtime-agnostic and unit-testable.
// Normalization: trim title, \n newlines + trim body, lowercase state.

export async function syncHash(title: string, body: string, state: "open" | "closed"): Promise<string> {
    const normTitle = title.trim()
    const normBody = body.replace(/\r\n/g, "\n").trim()
    const normState = state.toLowerCase()
    const input = `${normTitle}\n${normBody}\n${normState}`
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input))
    const bytes = new Uint8Array(digest)
    let hex = ""
    for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, "0")
    return hex
}
