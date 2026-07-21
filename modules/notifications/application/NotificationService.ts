// Notifications application — the drain use case as a service. Holds the wired
// dispatcher + outbox and owns the pull→dispatch→markDone loop (previously the
// free function drainNotifications). Pure application: it depends only on the
// NotificationDispatcher and the OutboxStore port — the composition root injects
// the concrete, service-role-backed collaborators.

import type { NotificationDispatcher } from "./NotificationDispatcher"
import type { OutboxStore } from "../ports/OutboxStore"

export class NotificationService {
    constructor(
        private readonly dispatcher: NotificationDispatcher,
        private readonly outbox: OutboxStore,
    ) {}

    /** Drain up to `limit` pending outbox events: dispatch each to its channels
     *  then mark it done. At-least-once — a crash between dispatch and markDone
     *  re-delivers, which is why channels are idempotent. Per-row best-effort: a
     *  row whose dispatch throws is left pending for the next drain rather than
     *  marked done. Returns the number delivered. */
    async drain(limit = 50): Promise<number> {
        const pending = await this.outbox.pullPending(limit)
        let delivered = 0
        for (const record of pending) {
            try {
                await this.dispatcher.dispatch(record.event)
                await this.outbox.markDone(record.id)
                delivered++
            } catch (e) {
                console.error(`[notifications] drain failed for ${record.id}:`, e)
            }
        }
        return delivered
    }
}
