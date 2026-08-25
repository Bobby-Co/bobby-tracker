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
export { NotificationPresenter } from "./domain/Events"

export type { NotificationChannel, DeliveryResult } from "./ports/NotificationChannel"
export type { Recipient, RecipientResolver } from "./ports/RecipientResolver"
export type { OutboxStore, OutboxRecord } from "./ports/OutboxStore"
export type { EnrichmentSource, EnrichmentSubject, Enrichment } from "./ports/EnrichmentSource"

export { NotificationDispatcher } from "./application/NotificationDispatcher"
export { NotificationService } from "./application/NotificationService"

export { createInAppFeedChannel } from "./infrastructure/InAppFeedChannel"
export { createEmailChannel } from "./infrastructure/EmailChannel"
export { createSupabaseRecipientResolver } from "./infrastructure/SupabaseRecipientResolver"
export { createSupabaseOutboxStore } from "./infrastructure/SupabaseOutboxStore"
export { createSupabaseEnrichmentSource } from "./infrastructure/SupabaseEnrichmentSource"

// The user-facing tray feed (RLS-scoped reads/writes on the notifications table).
export type { NotificationFeedRepository } from "./ports/NotificationFeedRepository"
export { createSupabaseNotificationFeedRepository } from "./infrastructure/SupabaseNotificationFeedRepository"

// Composition root: assembles a NotificationService (which owns drain()).
export { createNotificationService } from "./Composition"

// Legacy trigger-path email renderer (still serves /api/internal/notification-email
// until the outbox cutover retires it).
export { NotificationEmail } from "./infrastructure/NotificationEmail"

// The per-kind email templates BOTH senders render through. Pure — exported so a
// mail can be rendered (and eyeballed) without a transport or a database.
export type { NotificationEmailContext, RenderedEmail } from "./infrastructure/EmailTemplates"
export { renderNotificationEmail } from "./infrastructure/EmailTemplates"
