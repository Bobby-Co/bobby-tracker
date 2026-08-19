// Beta infrastructure — BetaAccessStamp over Supabase Auth's admin API.
//
// Writes `whitelisted` into the user's app-level auth metadata, which Supabase
// then mints into every subsequent access token. That is what lets the gate stay
// a synchronous property of the session (lib/shared/BetaAccess.ts) while the
// enrolment list lives in a table the browser cannot read.
//
// Requires the SERVICE-ROLE key: `auth.admin.*` is rejected outright with the
// anon key, so this adapter must never be handed a request-scoped client.

import type { SupabaseClient } from "@supabase/supabase-js"
import type { BetaAccessStamp } from "../ports/BetaAccessStamp"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any, any, any>

export class SupabaseAuthBetaAccessStamp implements BetaAccessStamp {
    constructor(private readonly db: AnyDb) {}

    async grant(userId: string): Promise<void> {
        await this.write(userId, true)
    }

    async revoke(userId: string): Promise<void> {
        // `false`, not a delete: GoTrue MERGES the object it is given, so omitting
        // the key would leave the old `true` in place — a revoke that silently
        // does nothing.
        await this.write(userId, false)
    }

    private async write(userId: string, whitelisted: boolean): Promise<void> {
        const { error } = await this.db.auth.admin.updateUserById(userId, {
            user_metadata: { whitelisted },
        })
        // Throws rather than reporting a boolean. The caller's only sensible
        // response is to fail the request: pretending the stamp landed leaves an
        // enrolled user bouncing between /waitlist and the app forever.
        if (error) throw new Error(`beta stamp failed for ${userId}: ${error.message}`)
    }
}

/** Composition seam: bind a BetaAccessStamp to a service-role Supabase client. */
export function createSupabaseAuthBetaAccessStamp(db: AnyDb): BetaAccessStamp {
    return new SupabaseAuthBetaAccessStamp(db)
}
