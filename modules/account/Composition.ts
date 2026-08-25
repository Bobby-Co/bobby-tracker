// Account module — composition root. The identity store needs the SERVICE-ROLE
// key (auth.admin.*), so it binds to Supabase.service() rather than to a
// request-scoped client.

import { Supabase } from "@/lib/server/supabase"
import { createSupabaseAuthIdentityStore } from "./infrastructure/SupabaseAuthIdentityStore"
import { JmapAccountMailer } from "./infrastructure/JmapAccountMailer"
import { createSupabaseAuthWelcomeLedger } from "./infrastructure/SupabaseAuthWelcomeLedger"
import type { AccountIdentityStore } from "./ports/AccountIdentityStore"
import type { AccountMailer } from "./ports/AccountMailer"
import type { WelcomeLedger } from "./ports/WelcomeLedger"

export function getAccountIdentityStore(): AccountIdentityStore {
    return createSupabaseAuthIdentityStore(Supabase.service())
}

/** The app-wide AccountMailer (the JMAP email adapter today). */
export function createAccountMailer(): AccountMailer {
    return new JmapAccountMailer()
}

/** The welcome ledger, on the service-role client (auth.admin.*). */
export function getWelcomeLedger(): WelcomeLedger {
    return createSupabaseAuthWelcomeLedger(Supabase.service())
}
