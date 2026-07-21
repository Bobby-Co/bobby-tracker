// Notifications — composition root for a server-to-server context: it assembles
// the dispatcher with its channels + the team-aware recipient resolver and the
// outbox store into a NotificationService (which owns the drain use case).
//
// FLOW after cutover (migration 0054): a DB trigger enqueues an event into
// tracker.notification_outbox and pg_net pings the drain endpoint;
// NotificationService.drain() pulls pending events and dispatches each to its
// channels, then marks it done.
//
// SAFE BEFORE CUTOVER: with no producer enqueuing yet, the outbox is empty, so
// drain() is a no-op (one cheap SELECT that returns nothing). Deploying this
// ahead of 0054 changes no behaviour.

import type { SupabaseClient } from "@supabase/supabase-js"

import { NotificationDispatcher } from "./application/NotificationDispatcher"
import { NotificationService } from "./application/NotificationService"
// The service client is schema-bound to "tracker"; accept any schema generic so
// the concrete client (SupabaseClient<…,"tracker",…>) is assignable here, and it
// stays assignable to the adapters' plain SupabaseClient params below.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ServiceDb = SupabaseClient<any, any, any>
import { createInAppFeedChannel } from "./infrastructure/InAppFeedChannel"
import { createEmailChannel } from "./infrastructure/EmailChannel"
import { createSupabaseRecipientResolver } from "./infrastructure/SupabaseRecipientResolver"
import { createSupabaseOutboxStore } from "./infrastructure/SupabaseOutboxStore"

/** Assemble the notification pipeline. Pass a SERVICE-ROLE client — the in-app
 *  insert, the auth-admin email lookup, and the outbox all require it. Register
 *  a new channel here (OCP) to add web-push/Slack/etc. later. */
export function createNotificationService(svc: ServiceDb): NotificationService {
    const dispatcher = new NotificationDispatcher(createSupabaseRecipientResolver(svc))
        .register(createInAppFeedChannel(svc))
        .register(createEmailChannel())
    return new NotificationService(dispatcher, createSupabaseOutboxStore(svc))
}
