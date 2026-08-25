// Beta infrastructure — the Supabase adapter for BetaWaitlistRepository. The only
// place that touches tracker.beta_requests. Service-role, control plane, for the
// same reasons as the allowlist adapter next to it.

import type { SupabaseClient } from "@supabase/supabase-js"
import { RepositoryError } from "@/lib/shared/kernel"
import type { BetaEmail } from "../domain/BetaEmail"
import type { BetaRequest, BetaWaitlistRepository } from "../ports/BetaWaitlistRepository"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any, any, any>

const TABLE = "beta_requests"
const COLS = "email, user_id, display_name, requested_at, source"

export class SupabaseBetaWaitlistRepository implements BetaWaitlistRepository {
    constructor(private readonly db: AnyDb) {}

    async record(
        email: BetaEmail,
        who: { userId?: string | null; displayName?: string | null; source?: string },
    ): Promise<boolean> {
        // ignoreDuplicates keeps the FIRST request: the row's whole purpose is to
        // say how long someone has been waiting, and an upsert would reset that
        // every time they reload the page and press the button again.
        //
        // The trailing select is what turns that into an ANSWER. `ON CONFLICT DO
        // NOTHING` returns the row it inserted and nothing at all when it
        // skipped, so an empty result means "already waiting" — which is how the
        // caller knows not to send a second confirmation email.
        const { data, error } = await this.db
            .from(TABLE)
            .upsert(
                {
                    email: email.value,
                    user_id: who.userId ?? null,
                    display_name: who.displayName ?? null,
                    source: who.source ?? "waitlist",
                },
                { onConflict: "email", ignoreDuplicates: true },
            )
            .select("email")
        if (error) throw new RepositoryError(error.message, { cause: error })
        return (data?.length ?? 0) > 0
    }

    async remove(email: BetaEmail): Promise<void> {
        const { error } = await this.db.from(TABLE).delete().eq("email", email.value)
        if (error) throw new RepositoryError(error.message, { cause: error })
    }

    async list(limit = 200): Promise<BetaRequest[]> {
        const { data, error } = await this.db
            .from(TABLE)
            .select(COLS)
            .order("requested_at", { ascending: true })
            .limit(limit)
        if (error) throw new RepositoryError(error.message, { cause: error })
        return (data as BetaRequest[] | null) ?? []
    }
}

/** Composition seam: bind a BetaWaitlistRepository to a Supabase client. */
export function createSupabaseBetaWaitlistRepository(db: AnyDb): BetaWaitlistRepository {
    return new SupabaseBetaWaitlistRepository(db)
}
