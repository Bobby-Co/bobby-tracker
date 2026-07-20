// Analysis module — composition root. Wires the AnalyserPort to its concrete
// adapter for the Next/Workers host. A future host (node-server, queue-consumer)
// or a service extraction swaps ONLY this file — callers depend on getAnalyser()
// and the AnalyserPort interface, never on the transport (see modules/README.md).

import { createHttpAnalyser } from "./infrastructure/http-analyser"
import type { AnalyserPort } from "./ports/analyser-port"

/** The app-wide AnalyserPort. Returns the HTTP-backed adapter today; the seam
 *  lets a different transport be injected here without touching call sites. */
export function getAnalyser(): AnalyserPort {
    return createHttpAnalyser()
}
