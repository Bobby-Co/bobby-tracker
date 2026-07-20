// Domain events + the EventBus PORT. Modules publish events; other modules
// subscribe. In-process today (InProcessEventBus); a broker/queue adapter can
// implement the same port later without any publisher or subscriber changing —
// that substitutability is the whole point (LSP).
//
// Part of the shared kernel (see modules/README.md). Pure — no framework/SDK
// imports.

export interface DomainEvent<T = unknown> {
    /** Stable event name, e.g. "pr.reviewed", "issue.analysed". */
    readonly type: string
    /** When the fact occurred (ISO-8601). Emitters set this via the Clock port. */
    readonly occurredAt: string
    /** Event-specific payload. */
    readonly payload: T
}

export type EventHandler<E extends DomainEvent = DomainEvent> = (event: E) => void | Promise<void>

/** The publish/subscribe seam. Contract every adapter must honour: `publish`
 *  never rejects because a *subscriber* failed — a handler error is isolated so
 *  one channel can't break another. Publishers await delivery-accepted, not
 *  delivery-complete. */
export interface EventBus {
    publish(event: DomainEvent): Promise<void>
    subscribe(type: string, handler: EventHandler): () => void
}

/** Minimal in-process bus. Handlers for a type run concurrently; a rejection is
 *  caught and logged, never propagated to the publisher — the same observable
 *  contract a queue-backed adapter will provide, so callers don't change when
 *  the bus is swapped. */
export class InProcessEventBus implements EventBus {
    private readonly handlers = new Map<string, Set<EventHandler>>()

    subscribe(type: string, handler: EventHandler): () => void {
        const set = this.handlers.get(type) ?? new Set<EventHandler>()
        set.add(handler)
        this.handlers.set(type, set)
        return () => {
            set.delete(handler)
        }
    }

    async publish(event: DomainEvent): Promise<void> {
        const set = this.handlers.get(event.type)
        if (!set || set.size === 0) return
        await Promise.all(
            Array.from(set).map(async (handler) => {
                try {
                    await handler(event)
                } catch (e) {
                    console.error(`[eventbus] handler for "${event.type}" failed:`, e)
                }
            }),
        )
    }
}
