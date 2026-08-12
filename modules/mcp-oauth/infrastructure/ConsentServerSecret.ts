// The server-side secret the consent screen's CSRF token is HMAC'd under (see
// domain/ConsentCsrf for the rationale).
//
// The only property required is that it is stable for the life of a consent
// round trip and never reaches the browser. It is NOT sent anywhere, and only
// ever used as an HMAC key — the token derived from it is one-way, so publishing
// a token reveals nothing about the key.
//
// It defaults to the service-role key because that is guaranteed present in every
// deployment (Supabase.service() needs it) and is already the app's most tightly
// held server secret, which keeps this from adding another required env var. A
// dedicated MCP_CONSENT_SECRET takes precedence for anyone who prefers one key per
// purpose; rotating either simply invalidates consent forms that are mid-flight,
// and the user just clicks Approve again.

export class ConsentServerSecret {
    static read(): string {
        return process.env.MCP_CONSENT_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || ""
    }

    /** False when neither secret is set — the consent screen refuses to render a
     *  form it cannot protect, rather than minting a forgeable token. */
    static isConfigured(): boolean {
        return ConsentServerSecret.read() !== ""
    }
}
