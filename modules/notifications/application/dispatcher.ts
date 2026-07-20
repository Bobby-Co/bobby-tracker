// Notifications application — the observer fan-out. Register channels once
// (OCP: adding a channel is one register() call, this class is untouched);
// dispatch resolves recipients and delivers each event to every channel it
// targets, intersected with the recipient's preferences, isolating per-delivery
// failures so one channel can never break another.
//
// Pure application: depends only on the domain + ports (no SDK/framework).

import type { NotificationEvent } from "../domain/events"
import { defaultChannelsFor } from "../domain/events"
import type { NotificationChannel } from "../ports/notification-channel"
import type { RecipientResolver } from "../ports/recipient-resolver"

export class NotificationDispatcher {
    private readonly channels = new Map<string, NotificationChannel>()

    constructor(private readonly recipients: RecipientResolver) {}

    /** Register a channel. Idempotent by id. Returns this for chaining at the
     *  composition root. */
    register(channel: NotificationChannel): this {
        this.channels.set(channel.id, channel)
        return this
    }

    /** Fan one event out to every applicable (recipient × channel). A channel
     *  applies when the event targets it, the recipient hasn't opted out, and the
     *  channel supports this (event, recipient). Failures are isolated. */
    async dispatch(event: NotificationEvent): Promise<void> {
        const recipients = await this.recipients.resolve(event)
        if (recipients.length === 0) return
        const targeted = new Set<string>(defaultChannelsFor(event.kind))

        await Promise.all(
            recipients.flatMap((recipient) =>
                Array.from(this.channels.values())
                    .filter(
                        (channel) =>
                            targeted.has(channel.id) &&
                            recipient.channels.includes(channel.id) &&
                            channel.supports(event, recipient),
                    )
                    .map(async (channel) => {
                        try {
                            const result = await channel.deliver(event, recipient)
                            if (!result.delivered && result.reason) {
                                console.warn(`[notifications] ${channel.id} skipped ${recipient.userId}: ${result.reason}`)
                            }
                        } catch (e) {
                            console.error(`[notifications] channel "${channel.id}" threw for ${recipient.userId}:`, e)
                        }
                    }),
            ),
        )
    }
}
