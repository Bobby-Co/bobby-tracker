// Notifications — composition + drain. This is the module's composition root for
// a server-to-server context: it assembles the dispatcher with its channels and
// the team-aware recipient resolver, and drains the outbox.
//
// FLOW after cutover (migration 0054): a DB trigger enqueues an event into
// tracker.notification_outbox and pg_net pings the drain endpoint; drain() pulls
// pending events and dispatches each to its channels, then marks it done.
//
// SAFE BEFORE CUTOVER: with no producer enqueuing yet, the outbox is empty, so
// drain() is a no-op (one cheap SELECT that returns nothing). Deploying this
// ahead of 0054 changes no behaviour.

import type { SupabaseClient } from "@supabase/supabase-js"

import { NotificationDispatcher } from "./application/dispatcher"
// The service client is schema-bound to "tracker"; accept any schema generic so
// the concrete client (SupabaseClient<…,"tracker",…>) is assignable here, and it
// stays assignable to the adapters' plain SupabaseClient params below.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ServiceDb = SupabaseClient<any, any, any>
import { createInAppFeedChannel } from "./infrastructure/in-app-feed-channel"
import { createEmailChannel } from "./infrastructure/email-channel"
import { createSupabaseRecipientResolver } from "./infrastructure/supabase-recipient-resolver"
import { createSupabaseOutboxStore } from "./infrastructure/supabase-outbox-store"

/** Assemble the notification pipeline. Pass a SERVICE-ROLE client — the in-app
 *  insert, the auth-admin email lookup, and the outbox all require it. Register
 *  a new channel here (OCP) to add web-push/Slack/etc. later. */
export function createNotificationService(svc: ServiceDb) {
    const dispatcher = new NotificationDispatcher(createSupabaseRecipientResolver(svc))
        .register(createInAppFeedChannel(svc))
        .register(createEmailChannel())
    const outbox = createSupabaseOutboxStore(svc)
    return { dispatcher, outbox }
}

/** Drain up to `limit` pending outbox events: dispatch each to its channels then
 *  mark it done. At-least-once — a crash between dispatch and markDone re-delivers,
 *  which is why channels are idempotent. Per-row best-effort: a row whose dispatch
 *  throws is left pending for the next drain rather than marked done. Returns the
 *  number delivered. */
export async function drainNotifications(svc: ServiceDb, limit = 50): Promise<number> {
    const { dispatcher, outbox } = createNotificationService(svc)
    const pending = await outbox.pullPending(limit)
    let delivered = 0
    for (const record of pending) {
        try {
            await dispatcher.dispatch(record.event)
            await outbox.markDone(record.id)
            delivered++
        } catch (e) {
            console.error(`[notifications] drain failed for ${record.id}:`, e)
        }
    }
    return delivered
}
