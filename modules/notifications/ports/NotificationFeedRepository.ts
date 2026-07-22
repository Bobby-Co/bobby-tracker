// Notifications module — the user-facing FEED persistence PORT. The bell's feed
// is RLS-scoped to the caller (notifications_owner_* policies), distinct from the
// observer/dispatch side of this module (events, channels, outbox). The tray
// routes read/write it through this contract.

import type { Notification } from "@/lib/shared/types"

export interface NotificationFeedRepository {
    /** The caller's feed, newest first, capped at `limit`. THROWS RepositoryError
     *  on a query failure. */
    listRecent(limit: number): Promise<Notification[]>

    /** Mark every currently-unread notification read (stamps read_at now, only
     *  where it's null so an already-read row keeps its original timestamp).
     *  Throws on failure. */
    markAllRead(): Promise<void>

    /** Mark one notification read (idempotent: no-op if already read). Throws. */
    markRead(id: string): Promise<void>

    /** Remove one notification from the feed (RLS scopes to the owner). Throws. */
    remove(id: string): Promise<void>
}
