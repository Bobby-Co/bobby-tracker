// Beta bounded context — PUBLIC CONTRACT (see modules/README.md).
//
// Owns who is in the closed beta: tracker.beta_allowlist (invitations) and
// tracker.beta_requests (the queue), both from migration 0074. It replaced
// NEXT_PUBLIC_BETA_ALLOWED_EMAILS, which could only be changed by redeploying and
// shipped the list to every visitor's browser.
//
// ─── The one thing to understand before touching this ────────────────────────
//
// The list is in the database, but the GATE is not. lib/shared/BetaAccess.ts runs
// in the browser (route guards, the waitlist page) and must answer synchronously,
// and since 0067 the browser reads nothing from tracker.*. So the flow is:
//
//   sign-in / POST /api/beta/access
//        → BetaEnrollmentService.admit()
//        → allowlist lookup with the service-role key
//        → on a hit, stamp `whitelisted: true` into the user's auth metadata
//        → the flag rides in the JWT from the next token refresh onward
//        → BetaAccess (sync, client-safe) reads that flag, as it always has
//
// Consequences worth knowing, both deliberate: enrolment takes effect on the
// user's next session refresh (the waitlist page triggers one for itself), and
// deleting a row withdraws an INVITATION without evicting anyone already admitted
// — see BetaEnrollmentService.revoke / revokeUser.

// ─── domain: the normalised address ──────────────────────────────────────────
export { BetaEmail } from "./domain/BetaEmail"

// ─── the enrolment use cases ─────────────────────────────────────────────────
export { BetaEnrollmentService } from "./application/BetaEnrollmentService"
export type { BetaIdentity } from "./application/BetaEnrollmentService"

// ─── ports (the roles) + their Supabase adapters ─────────────────────────────
export type { BetaAllowlistRepository, BetaAllowlistEntry } from "./ports/BetaAllowlistRepository"
export type { BetaWaitlistRepository, BetaRequest } from "./ports/BetaWaitlistRepository"
export type { BetaAccessStamp } from "./ports/BetaAccessStamp"
export { createSupabaseBetaAllowlistRepository } from "./infrastructure/SupabaseBetaAllowlistRepository"
export { createSupabaseBetaWaitlistRepository } from "./infrastructure/SupabaseBetaWaitlistRepository"
export { createSupabaseAuthBetaAccessStamp } from "./infrastructure/SupabaseAuthBetaAccessStamp"

// ─── who may edit the list ───────────────────────────────────────────────────
export { EnvBetaStaff } from "./infrastructure/EnvBetaStaff"

// ─── composition seams ───────────────────────────────────────────────────────
export { getBetaEnrollmentService, getBetaWaitlist } from "./Composition"
