// Notifications — the OutboxStore PORT. The durability primitive for a stack
// with NO cron: a producer enqueues the event in the SAME transaction as the
// business fact it describes, so the notification can't drift from the data; a
// drain (BackgroundTasks `after()` today, a queue consumer once extracted)
// delivers it and marks it done. Delivery is at-least-once, which is exactly why
// NotificationChannel.deliver must be idempotent.

import type { NotificationEvent } from "../domain/Events"

export interface OutboxRecord {
    readonly id: string
    readonly event: NotificationEvent
}

export interface OutboxStore {
    /** Persist an event for delivery. */
    enqueue(event: NotificationEvent): Promise<void>
    /** Claim up to `limit` undelivered events to drain. */
    pullPending(limit: number): Promise<OutboxRecord[]>
    /** Mark an event delivered so it isn't drained again. */
    markDone(id: string): Promise<void>
}
