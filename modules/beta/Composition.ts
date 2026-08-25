// Beta module — composition root.
//
// Everything here binds to `Supabase.service()`, and that is not a shortcut:
//
//   • tracker.beta_allowlist and tracker.beta_requests have RLS enabled with no
//     policies (0074), so any other client reads zero rows — an enrolled user
//     would look un-enrolled;
//   • the stamp goes through auth.admin.*, which only the service-role key may
//     call.
//
// Both tables are CONTROL plane: enrolment belongs to an identity, and identities
// do not move with a team's region.

import { Supabase } from "@/lib/server/supabase"
import { BetaEnrollmentService } from "./application/BetaEnrollmentService"
import { createSupabaseBetaAllowlistRepository } from "./infrastructure/SupabaseBetaAllowlistRepository"
import { createSupabaseBetaWaitlistRepository } from "./infrastructure/SupabaseBetaWaitlistRepository"
import { createSupabaseAuthBetaAccessStamp } from "./infrastructure/SupabaseAuthBetaAccessStamp"
import { JmapBetaMailer } from "./infrastructure/JmapBetaMailer"
import type { BetaMailer } from "./ports/BetaMailer"
import type { BetaWaitlistRepository } from "./ports/BetaWaitlistRepository"

/** The enrolment use cases, bound to the control database. */
export function getBetaEnrollmentService(): BetaEnrollmentService {
    const db = Supabase.service()
    return new BetaEnrollmentService(
        createSupabaseBetaAllowlistRepository(db),
        createSupabaseAuthBetaAccessStamp(db),
    )
}

/** The waitlist queue — who has asked to be let in. */
export function getBetaWaitlist(): BetaWaitlistRepository {
    return createSupabaseBetaWaitlistRepository(Supabase.service())
}

/** The beta mailer (the JMAP email adapter today). Needs no database — the two
 *  mails it sends are told everything they need by their caller. */
export function createBetaMailer(): BetaMailer {
    return new JmapBetaMailer()
}
