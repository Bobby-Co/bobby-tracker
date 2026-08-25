// BetaAccessStamp — the PORT for "let this identity into the app".
//
// The gate that actually runs on every page (lib/shared/BetaAccess.ts) is
// SYNCHRONOUS and runs in the browser, where no tracker.* table is readable. So
// enrolment has to end up somewhere the client already holds: the user's auth
// metadata, which rides in the JWT.
//
// This port is that write, kept abstract for a concrete reason — it is the one
// step tied to the identity provider rather than to our schema. A move off
// Supabase Auth replaces this adapter and nothing else in the module.
export interface BetaAccessStamp {
    /** Mark the identity as admitted to the beta. Idempotent.
     *  THROWS on failure — a silent no-op here strands an enrolled user on the
     *  waitlist with no way to tell why. */
    grant(userId: string): Promise<void>

    /** Remove the mark. Takes effect on the user's next token refresh, not
     *  instantly — the flag they already hold stays valid until then. */
    revoke(userId: string): Promise<void>
}
