// Account infrastructure — WelcomeLedger over Supabase Auth's admin API.
//
// The mark is `welcomed_at` in the user's auth metadata: there is no profiles
// table in this app, and auth.users is the only row that exists for every
// account regardless of which teams they're in.
//
// Requires the SERVICE-ROLE key (`auth.admin.*` is rejected with the anon key).
// The user could clear the mark themselves through their own updateUser call —
// the consequence is one extra welcome to an address the identity provider has
// already verified, which is not worth defending against.

import type { SupabaseClient } from "@supabase/supabase-js"

import type { WelcomeLedger } from "../ports/WelcomeLedger"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any, any, any>

export class SupabaseAuthWelcomeLedger implements WelcomeLedger {
    constructor(private readonly db: AnyDb) {}

    async claim(userId: string): Promise<boolean> {
        try {
            const { data, error } = await this.db.auth.admin.getUserById(userId)
            if (error || !data?.user) return false
            if (data.user.user_metadata?.welcomed_at) return false

            // Stamped BEFORE the send, deliberately. Stamping afterwards would
            // mean a transport failure leaves the mark unset and every later
            // visit tries again; at-most-once is the right bias for a mail whose
            // only job is to say hello.
            const { error: writeErr } = await this.db.auth.admin.updateUserById(userId, {
                user_metadata: { welcomed_at: new Date().toISOString() },
            })
            if (writeErr) return false
            return true
        } catch {
            return false
        }
    }
}

/** Composition seam: bind a WelcomeLedger to a service-role Supabase client. */
export function createSupabaseAuthWelcomeLedger(db: AnyDb): WelcomeLedger {
    return new SupabaseAuthWelcomeLedger(db)
}
