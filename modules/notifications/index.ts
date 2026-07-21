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
} from "./domain/Events"
export { renderNotification, defaultChannelsFor } from "./domain/Events"

export type { NotificationChannel, DeliveryResult } from "./ports/NotificationChannel"
export type { Recipient, RecipientResolver } from "./ports/RecipientResolver"
export type { OutboxStore, OutboxRecord } from "./ports/OutboxStore"

export { NotificationDispatcher } from "./application/NotificationDispatcher"
export { NotificationService } from "./application/NotificationService"

export { createInAppFeedChannel } from "./infrastructure/InAppFeedChannel"
export { createEmailChannel } from "./infrastructure/EmailChannel"
export { createSupabaseRecipientResolver } from "./infrastructure/SupabaseRecipientResolver"
export { createSupabaseOutboxStore } from "./infrastructure/SupabaseOutboxStore"

// Composition root: assembles a NotificationService (which owns drain()).
export { createNotificationService } from "./Composition"

// Legacy trigger-path email renderer (still serves /api/internal/notification-email
// until the outbox cutover retires it).
export { sendNotificationEmail } from "./infrastructure/NotificationEmail"
