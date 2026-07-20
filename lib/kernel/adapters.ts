// Concrete kernel adapters. THIS is the boundary file that may touch the
// runtime — everything else in the kernel (result/events/ports) stays pure.
// Swapping runtime = swapping this file (Workers `after()` → a Node queue),
// and nothing that depends on the ports changes.
//
// NOTE: import adapters explicitly from "@/lib/kernel/adapters" at a composition
// root — they are deliberately NOT re-exported from the kernel barrel, so pure
// code that imports "@/lib/kernel" never transitively pulls in next/server.

import { after } from "next/server"
import type { BackgroundTasks, Clock, IdGenerator } from "./ports"

export const systemClock: Clock = {
    now: () => new Date(),
    isoNow: () => new Date().toISOString(),
}

/** Workers/Next adapter: keeps post-response work alive past the response via
 *  `after()` (see the workers-detached-promises constraint — a bare `void`
 *  promise is cancelled). A Node adapter would enqueue instead; same port. */
export const workersBackgroundTasks: BackgroundTasks = {
    run: (task) => {
        after(task)
    },
}

/** Web Crypto is a global on Workers and Node ≥ 19, so this adapter is already
 *  runtime-portable as written. */
export const cryptoIdGenerator: IdGenerator = {
    uuid: () => crypto.randomUUID(),
}
