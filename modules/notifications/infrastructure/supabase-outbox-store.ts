// Notifications infrastructure — the Supabase OutboxStore adapter. Persists
// events into the EXISTING `notification_outbox` table (migration 0053) and
// hands them back to the drain. This is the transactional-outbox durability
// primitive for a stack with no cron: enqueue in the same transaction as the
// business fact, drain via the app.
//
// DORMANT reference code: it typechecks but isn't wired to producers yet. The
// backing table is dormant too — 0053 must be applied by the operator before
// this runs.
//
// The caller injects a SERVICE-ROLE Supabase client — the outbox forbids all
// client-side access (RLS, no grants to authenticated), so we never construct a
// client here. The client is schema-bound to `tracker`, so the bare table name
// resolves to tracker.notification_outbox.

import type { SupabaseClient } from "@supabase/supabase-js"

import type { NotificationEvent } from "../domain/events"
import type { OutboxRecord, OutboxStore } from "../ports/outbox-store"

/** The Supabase adapter for OutboxStore. Construct via the factory below. */
export class SupabaseOutboxStore implements OutboxStore {
    constructor(private readonly db: SupabaseClient) {}

    async enqueue(event: NotificationEvent): Promise<void> {
        const { error } = await this.db.from("notification_outbox").insert({ event })
        if (error) throw new Error(`outbox enqueue failed: ${error.message}`)
    }

    async pullPending(limit: number): Promise<OutboxRecord[]> {
        const { data, error } = await this.db
            .from("notification_outbox")
            .select("id,event")
            .eq("status", "pending")
            .order("created_at", { ascending: true })
            .limit(limit)
        if (error) throw new Error(`outbox pullPending failed: ${error.message}`)
        return (data ?? []).map((row) => ({ id: row.id as string, event: row.event as NotificationEvent }))
    }

    async markDone(id: string): Promise<void> {
        const { error } = await this.db
            .from("notification_outbox")
            .update({ status: "done", delivered_at: new Date().toISOString() })
            .eq("id", id)
        if (error) throw new Error(`outbox markDone failed: ${error.message}`)
    }
}

/** Composition seam: bind an OutboxStore to a Supabase client. */
export function createSupabaseOutboxStore(db: SupabaseClient): OutboxStore {
    return new SupabaseOutboxStore(db)
}
