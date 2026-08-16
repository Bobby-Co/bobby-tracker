// Notifications infrastructure — the Supabase adapter for the user-facing feed.
// The only place that queries the notifications table for the tray. Bound to the
// caller's RLS-scoped client, so every read/write is owner-scoped by the database
// (the UPDATE grant is also column-scoped to read_at, migration 0049).

import type { SupabaseClient } from "@supabase/supabase-js"
import { RepositoryError } from "@/lib/shared/kernel"
import type { Notification } from "@/lib/shared/types"
import type { NotificationFeedRepository } from "../ports/NotificationFeedRepository"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any, any, any>

export class SupabaseNotificationFeedRepository implements NotificationFeedRepository {
    constructor(private readonly db: AnyDb) {}

    async listRecent(userId: string, limit: number): Promise<Notification[]> {
        const { data, error } = await this.db
            .from("notifications")
            .select("*")
            .eq("user_id", userId)
            .order("created_at", { ascending: false })
            .limit(limit)
        if (error) throw new RepositoryError(error.message, { cause: error })
        return (data ?? []) as Notification[]
    }

    async markAllRead(userId: string): Promise<void> {
        const { error } = await this.db
            .from("notifications")
            .update({ read_at: new Date().toISOString() })
            .eq("user_id", userId)
            .is("read_at", null)
        if (error) throw new RepositoryError(error.message, { cause: error })
    }

    async markRead(userId: string, id: string): Promise<void> {
        const { error } = await this.db
            .from("notifications")
            .update({ read_at: new Date().toISOString() })
            .eq("user_id", userId)
            .eq("id", id)
            .is("read_at", null)
        if (error) throw new RepositoryError(error.message, { cause: error })
    }

    async remove(userId: string, id: string): Promise<void> {
        const { error } = await this.db.from("notifications").delete().eq("user_id", userId).eq("id", id)
        if (error) throw new RepositoryError(error.message, { cause: error })
    }
}

/** Composition seam: bind a NotificationFeedRepository to a specific Supabase client. */
export function createSupabaseNotificationFeedRepository(db: AnyDb): NotificationFeedRepository {
    return new SupabaseNotificationFeedRepository(db)
}
