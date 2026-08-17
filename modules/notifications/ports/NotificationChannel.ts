// Notifications — the NotificationChannel PORT. Adapters (in-app feed, email,
// and later web-push/Slack) implement it; the dispatcher fans out to whichever
// are registered (OCP).

import type { ChannelId, NotificationEvent } from "../domain/Events"
import type { Recipient } from "./RecipientResolver"

export interface DeliveryResult {
    readonly delivered: boolean
    /** Why not delivered (opted out, unsupported, transient error) — for logs. */
    readonly reason?: string
}

/** A push channel. Behavioural contract EVERY implementation must honour (LSP,
 *  so the dispatcher can use any channel blind):
 *   - `deliver` is IDEMPOTENT for a given (event, recipient) — safe under the
 *     outbox's at-least-once retries.
 *   - `deliver` RESOLVES, never throws, when it can't apply (recipient opted
 *     out, no address, channel not applicable) — it returns
 *     { delivered:false, reason } instead. A thrown error means an unexpected
 *     fault, which the dispatcher isolates so one channel can't break another. */
export interface NotificationChannel {
    readonly id: ChannelId
    supports(event: NotificationEvent, recipient: Recipient): boolean
    deliver(event: NotificationEvent, recipient: Recipient): Promise<DeliveryResult>
}
