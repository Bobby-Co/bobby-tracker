// Concrete kernel adapters. THIS is the boundary file that may touch the
// runtime — everything else in the kernel (result/events/ports) stays pure.
// Swapping runtime = swapping this file (Workers `after()` → a Node queue),
// and nothing that depends on the ports changes.
//
// NOTE: import adapters explicitly from "@/lib/shared/kernel/adapters" at a composition
// root — they are deliberately NOT re-exported from the kernel barrel, so pure
// code that imports "@/lib/shared/kernel" never transitively pulls in next/server.

import { after } from "next/server"
import type { BackgroundTasks, Clock, IdGenerator } from "./ports"

class SystemClock implements Clock {
    now(): Date {
        return new Date()
    }
    isoNow(): string {
        return new Date().toISOString()
    }
}
export const systemClock: Clock = new SystemClock()

/** Workers/Next adapter: keeps post-response work alive past the response via
 *  `after()` (see the workers-detached-promises constraint — a bare `void`
 *  promise is cancelled). A Node adapter would enqueue instead; same port. */
class WorkersBackgroundTasks implements BackgroundTasks {
    run(task: () => void | Promise<void>): void {
        after(task)
    }
}
export const workersBackgroundTasks: BackgroundTasks = new WorkersBackgroundTasks()

/** Web Crypto is a global on Workers and Node ≥ 19, so this adapter is already
 *  runtime-portable as written. */
class CryptoIdGenerator implements IdGenerator {
    uuid(): string {
        return crypto.randomUUID()
    }
}
export const cryptoIdGenerator: IdGenerator = new CryptoIdGenerator()
