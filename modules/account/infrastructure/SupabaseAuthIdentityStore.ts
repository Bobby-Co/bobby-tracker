// Account infrastructure — AccountIdentityStore over Supabase Auth's admin API.
// Requires the SERVICE-ROLE key; `auth.admin.*` is rejected with the anon key.

import type { SupabaseClient } from "@supabase/supabase-js"
import type { AccountIdentityStore } from "../ports/AccountIdentityStore"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any, any, any>

export class SupabaseAuthIdentityStore implements AccountIdentityStore {
    constructor(private readonly db: AnyDb) {}

    async delete(userId: string): Promise<void> {
        const { error } = await this.db.auth.admin.deleteUser(userId)
        if (!error) return
        // Already gone — the caller retried after a partial failure, or two tabs
        // pressed the button. The end state is the one they asked for.
        if (/not.?found/i.test(error.message)) return
        throw new Error(`account deletion failed for ${userId}: ${error.message}`)
    }
}

/** Composition seam: bind an AccountIdentityStore to a service-role client. */
export function createSupabaseAuthIdentityStore(db: AnyDb): AccountIdentityStore {
    return new SupabaseAuthIdentityStore(db)
}
