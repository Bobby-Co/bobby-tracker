// Relay infrastructure — the Supabase adapter for RelayWorkerRepository. The only
// place that queries the relay_workers table. Bound to the caller's RLS-scoped
// client, so every read/write is owner-scoped by the database.

import type { SupabaseClient } from "@supabase/supabase-js"
import { RepositoryError } from "@/lib/shared/kernel"
import type { RelayWorkerRepository, RelayWorkerRow } from "../ports/RelayWorkerRepository"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any, any, any>

export class SupabaseRelayWorkerRepository implements RelayWorkerRepository {
    constructor(private readonly db: AnyDb) {}

    async listActive(): Promise<RelayWorkerRow[]> {
        const { data, error } = await this.db
            .from("relay_workers")
            .select("*")
            .is("revoked_at", null)
            .order("created_at", { ascending: false })
        if (error) throw new RepositoryError(error.message, { cause: error })
        return (data ?? []) as RelayWorkerRow[]
    }

    async rename(id: string, name: string): Promise<void> {
        const { error } = await this.db.from("relay_workers").update({ name }).eq("id", id)
        if (error) throw new RepositoryError(error.message, { cause: error })
    }

    async revoke(id: string): Promise<void> {
        const { error } = await this.db
            .from("relay_workers")
            .update({ revoked_at: new Date().toISOString() })
            .eq("id", id)
        if (error) throw new RepositoryError(error.message, { cause: error })
    }
}

/** Composition seam: bind a RelayWorkerRepository to a specific Supabase client. */
export function createSupabaseRelayWorkerRepository(db: AnyDb): RelayWorkerRepository {
    return new SupabaseRelayWorkerRepository(db)
}
