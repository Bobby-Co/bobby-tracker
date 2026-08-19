// Beta infrastructure — the Supabase adapter for BetaAllowlistRepository. The
// only place that touches tracker.beta_allowlist.
//
// Always bound to a SERVICE-ROLE client (RLS on the table is enabled with no
// policies), and always on the CONTROL plane: enrolment is a property of an
// identity, and identities don't move with a team's region.

import type { SupabaseClient } from "@supabase/supabase-js"
import { RepositoryError } from "@/lib/shared/kernel"
import type { BetaEmail } from "../domain/BetaEmail"
import type { BetaAllowlistEntry, BetaAllowlistRepository } from "../ports/BetaAllowlistRepository"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any, any, any>

const TABLE = "beta_allowlist"
const COLS = "email, invited_by, note, created_at, granted_at, granted_user"

export class SupabaseBetaAllowlistRepository implements BetaAllowlistRepository {
    constructor(private readonly db: AnyDb) {}

    async find(email: BetaEmail): Promise<BetaAllowlistEntry | null> {
        const { data, error } = await this.db
            .from(TABLE)
            .select(COLS)
            .eq("email", email.value)
            .maybeSingle<BetaAllowlistEntry>()
        // Deliberately NOT fail-safe. A read error here is indistinguishable from
        // "not invited" if we swallow it, and that turns a transient database
        // blip into every beta user being bounced to the waitlist.
        if (error) throw new RepositoryError(error.message, { cause: error })
        return data ?? null
    }

    async list(): Promise<BetaAllowlistEntry[]> {
        const { data, error } = await this.db
            .from(TABLE)
            .select(COLS)
            .order("created_at", { ascending: false })
        if (error) throw new RepositoryError(error.message, { cause: error })
        return (data as BetaAllowlistEntry[] | null) ?? []
    }

    async add(
        email: BetaEmail,
        invite: { invitedBy?: string | null; note?: string | null },
    ): Promise<BetaAllowlistEntry> {
        // Upsert without granted_*: re-inviting somebody who has already been
        // admitted must not erase the record that they were.
        const { data, error } = await this.db
            .from(TABLE)
            .upsert(
                { email: email.value, invited_by: invite.invitedBy ?? null, note: invite.note ?? null },
                { onConflict: "email" },
            )
            .select(COLS)
            .single<BetaAllowlistEntry>()
        if (error) throw new RepositoryError(error.message, { cause: error })
        return data
    }

    async remove(email: BetaEmail): Promise<boolean> {
        const { data, error } = await this.db
            .from(TABLE)
            .delete()
            .eq("email", email.value)
            .select("email")
        if (error) throw new RepositoryError(error.message, { cause: error })
        return ((data as unknown[] | null) ?? []).length > 0
    }

    async markGranted(email: BetaEmail, userId: string): Promise<void> {
        // `.is("granted_at", null)` is what makes this first-write-wins: every
        // later sign-in matches zero rows instead of resetting the timestamp.
        const { error } = await this.db
            .from(TABLE)
            .update({ granted_at: new Date().toISOString(), granted_user: userId })
            .eq("email", email.value)
            .is("granted_at", null)
        if (error) throw new RepositoryError(error.message, { cause: error })
    }
}

/** Composition seam: bind a BetaAllowlistRepository to a Supabase client. */
export function createSupabaseBetaAllowlistRepository(db: AnyDb): BetaAllowlistRepository {
    return new SupabaseBetaAllowlistRepository(db)
}
