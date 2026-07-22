// Cross-cutting PORTS — pure interfaces the runtime provides. Domain and
// application code depend on these, never on the concrete runtime (Workers,
// Node, Date, crypto). The concrete adapters live in ./adapters.ts, the only
// kernel file allowed to import a framework/runtime API.
//
// Part of the shared kernel (see modules/README.md). Pure.

/** Wall-clock, injectable so the domain never calls Date.now() directly —
 *  ambient time makes pure logic non-deterministic and hard to test. */
export interface Clock {
    now(): Date
    isoNow(): string
}

/** Post-response / out-of-band work. On Workers a bare `void promise()` is
 *  cancelled when the isolate is torn down after the response; this port wraps
 *  the platform's keep-alive primitive (next/server `after()` today, a queue
 *  worker on Node later). Callers depend on the guarantee, not the mechanism. */
export interface BackgroundTasks {
    run(task: () => void | Promise<void>): void
}

/** Opaque id generation, injectable for the same reason as Clock. */
export interface IdGenerator {
    uuid(): string
}
