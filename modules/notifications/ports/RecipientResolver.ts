// Notifications — the RecipientResolver PORT. Resolves WHO should hear about an
// event. This is where the single-owner gap is fixed: the old triggers notified
// only projects.user_id, so teammates and collections got nothing. A team-aware
// resolver (infrastructure) fans an event out to every member who should see it.

import type { ChannelId, NotificationEvent } from "../domain/Events"

export interface Recipient {
    readonly userId: string
    readonly email: string | null
    /** The channels this user has NOT opted out of. Until a preferences store
     *  exists this is every channel; the dispatcher still intersects it with the
     *  event's default channels. */
    readonly channels: readonly ChannelId[]
}

export interface RecipientResolver {
    resolve(event: NotificationEvent): Promise<Recipient[]>
}
