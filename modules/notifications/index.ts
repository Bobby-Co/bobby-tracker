// Notifications module — PUBLIC CONTRACT (see modules/README.md). Other code
// wires the dispatcher + channels from here; producers will emit events through
// it. Nothing outside the module imports its internals directly.
//
// ─── STATUS: BUILT, NOT YET CUT OVER ────────────────────────────────────────
// The live notification system is still the DB-trigger path (migrations
// 0049/0051). This module is the app-side replacement, assembled and
// type-checked but deliberately NOT wired to any producer. Cutover — emitting
// events here from the PR/analyser flows and retiring the triggers — happens
// only AFTER migration 0053 (the outbox) is applied and the path is verified.
// Running both at once would double-fire notifications.

export type {
    NotificationEvent,
    NotificationKind,
    ChannelId,
    RenderedNotification,
} from "./domain/events"
export { renderNotification, defaultChannelsFor } from "./domain/events"

export type { NotificationChannel, DeliveryResult } from "./ports/notification-channel"
export type { Recipient, RecipientResolver } from "./ports/recipient-resolver"
export type { OutboxStore, OutboxRecord } from "./ports/outbox-store"

export { NotificationDispatcher } from "./application/dispatcher"

export { createInAppFeedChannel } from "./infrastructure/in-app-feed-channel"
export { createEmailChannel } from "./infrastructure/email-channel"
export { createSupabaseRecipientResolver } from "./infrastructure/supabase-recipient-resolver"
export { createSupabaseOutboxStore } from "./infrastructure/supabase-outbox-store"
