import type { User } from "@supabase/supabase-js"

// Beta access gate ("the whitelist"). A user is let into the app when EITHER:
//   • their auth metadata carries `whitelisted: true` — stamped by the server
//     from the enrolment table (tracker.beta_allowlist, migration 0074) at
//     sign-in or via POST /api/beta/access, OR
//   • their email is in NEXT_PUBLIC_BETA_ALLOWED_EMAILS (comma-separated) — the
//     STAFF BYPASS: a short list of our own addresses so the team is never locked
//     out by a bad row, an unapplied migration, or a stamp that failed to write.
// Everyone else is redirected to /waitlist.
//
// ─── Where the list actually lives ───────────────────────────────────────────
//
// In the database, not here. The env var used to BE the beta list; it is now the
// staff bypass and nothing more (see modules/beta for the enrolment flow).
//
// This file stays a synchronous metadata check on purpose. It is CLIENT-SAFE
// (lib/shared, not lib/server) so the SAME gate runs on the server (the OAuth
// callback) and in the browser (the app guard, onboarding, the waitlist page) —
// and the browser cannot read tracker.beta_allowlist at all, because RLS on that
// table is enabled with no policies. Making the gate async and fetch-backed would
// put a network round trip in front of every guarded render for a flag that is
// already in the JWT.
//
// The consequence to know: enrolment lands in the user's metadata, so it takes
// effect on their next token refresh. /waitlist asks POST /api/beta/access and
// refreshes its own session, so a newly enrolled user gets in without signing out.
//
// Still a single owner, so the source of truth can move again without touching
// the call sites in the callback, the app guard, onboarding, or the page.
export class BetaAccess {
    /** Whether this user may enter the app (vs. being sent to the waitlist). */
    isAllowed(user: User | null | undefined): boolean {
        if (!user) return false
        if (user.user_metadata?.whitelisted === true) return true

        const raw = process.env.NEXT_PUBLIC_BETA_ALLOWED_EMAILS ?? ""
        const allow = raw
            .split(",")
            .map((s) => s.trim().toLowerCase())
            .filter(Boolean)
        const email = (user.email ?? "").toLowerCase()
        return email.length > 0 && allow.includes(email)
    }
}
