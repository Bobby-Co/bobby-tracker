// Notifications infrastructure — the in-app feed NotificationChannel adapter.
// Writes a point-in-time row into the EXISTING `notifications` table (the feed
// the popover reads), rendering the event's presentation via the domain.
//
// DORMANT reference code: it typechecks but isn't wired to producers yet.
//
// The caller injects a SERVICE-ROLE Supabase client — the notifications table
// forbids client-side inserts (RLS), so we never construct a client here.

import type { SupabaseClient } from "@supabase/supabase-js"

import type { NotificationEvent } from "../domain/events"
import { renderNotification } from "../domain/events"
import type { NotificationChannel } from "../ports/notification-channel"
import type { Recipient } from "../ports/recipient-resolver"

export function createInAppFeedChannel(db: SupabaseClient): NotificationChannel {
    return {
        id: "in_app",
        supports(): boolean {
            return true
        },
        async deliver(event: NotificationEvent, recipient: Recipient) {
            const { title, meta, href } = renderNotification(event)

            // Idempotency will come from an outbox idempotency key / unique
            // constraint at cutover; a plain insert is fine while dormant.
            const { error } = await db.from("notifications").insert({
                user_id: recipient.userId,
                project_id: event.projectId,
                kind: event.kind,
                title,
                meta,
                href,
            })

            if (error) return { delivered: false, reason: error.message }
            return { delivered: true }
        },
    }
}
