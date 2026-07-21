// VCS module — the webhook-verification port. Verifying an inbound webhook is an
// APP-LEVEL concern (it authenticates the provider's signature over the raw
// body), not a per-repo one, so it lives on its own interface rather than on
// VCSAppInstance. Each provider signs differently (GitHub: HMAC-SHA256 over the
// body, compared to the `sha256=` x-hub-signature-256 header), so the webhook
// route depends on this port and the composition root supplies the impl.

export interface WebhookVerifier {
    /** True when `signature` (the provider's signature header) authenticates
     *  `rawBody`. Returns false — never throws — for a missing/malformed header. */
    verify(rawBody: string, signature: string | null): Promise<boolean>
}
