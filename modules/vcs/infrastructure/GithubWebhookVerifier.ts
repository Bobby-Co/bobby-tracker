// VCS module — the GitHub adapter for the WebhookVerifier port. Self-contained:
// it HMAC-SHA256s the raw request body with the app webhook secret and compares
// (constant-time) against the "sha256=<hex>" x-hub-signature-256 header. Never
// uses ===. The HMAC key + hex/compare are private methods.

import type { WebhookVerifier } from "../ports/WebhookVerifier"

export class GithubWebhookVerifier implements WebhookVerifier {
    private keyPromise: Promise<CryptoKey> | null = null

    async verify(rawBody: string, signature: string | null): Promise<boolean> {
        if (!signature || !signature.startsWith("sha256=")) return false
        const expected = signature.slice("sha256=".length)
        const key = await this.importKey()
        const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody)))
        return this.timingSafeHexEqual(this.bytesToHex(mac), expected)
    }

    private importKey(): Promise<CryptoKey> {
        if (this.keyPromise) return this.keyPromise
        this.keyPromise = (async () => {
            const secret = process.env.GITHUB_APP_WEBHOOK_SECRET
            if (!secret) throw new Error("GITHUB_APP_WEBHOOK_SECRET is not set")
            return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
                "sign",
            ])
        })().catch((e) => {
            this.keyPromise = null
            throw e
        })
        return this.keyPromise
    }

    private bytesToHex(bytes: Uint8Array): string {
        let hex = ""
        for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, "0")
        return hex
    }

    // Constant-time compare of two equal-length hex strings. Different lengths
    // short-circuit to false (a length difference isn't a secret).
    private timingSafeHexEqual(a: string, b: string): boolean {
        if (a.length !== b.length) return false
        let diff = 0
        for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
        return diff === 0
    }
}

/** Shared singleton — the verifier holds only a memoized key, no per-request state. */
export const githubWebhookVerifier: WebhookVerifier = new GithubWebhookVerifier()
