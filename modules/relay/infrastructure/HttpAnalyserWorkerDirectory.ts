// Relay infrastructure — the HTTP AnalyserWorkerDirectory adapter. Owns all the
// vendor/IO detail of the analyser fleet query: URL normalisation, the env
// bearer token, the fetch, the 2s abort budget, and the degrade-to-empty
// behaviour. Swapping the transport = swapping this file; nothing that depends
// on the AnalyserWorkerDirectory port changes.

import { getRegionRegistry } from "@/modules/regions"
import type { AnalyserWorkerDirectory } from "../ports/AnalyserWorkerDirectory"
import type { AnalyserWorker, AnalyserWorkers } from "../ports/RelayTypes"

/** The analyser-backed AnalyserWorkerDirectory. Best-effort by contract: any
 *  error / timeout / missing config degrades to empty maps (the UI then shows
 *  every worker offline). Construct via the composition root.
 *
 *  Queries the HOME cell's fleet only. Relay workers pair to a user, not a
 *  project, so there is no project cell to route by; when a second cell runs its
 *  own relay this needs to fan out across getRegionRegistry().configuredCells()
 *  and merge — deliberately not done blind, since it multiplies the 2s budget by
 *  the cell count and the right answer depends on whether relay is deployed per
 *  cell at all. */
export class HttpAnalyserWorkerDirectory implements AnalyserWorkerDirectory {
    async listConnected(): Promise<AnalyserWorkers> {
        const empty: AnalyserWorkers = { byWorkerId: new Map(), byUserId: new Map() }
        // Resolved per call, never at module load: a module-level const is frozen
        // into the Workers isolate at first import, so config changes (and, later,
        // per-request placement) would never be seen.
        const registry = getRegionRegistry()
        const { analyserUrl, analyserToken } = registry.cell(registry.homeCell())
        if (!analyserUrl) return empty

        const http = analyserUrl.replace(/\/+$/, "")
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 2000)
        try {
            const res = await fetch(`${http}/relay/workers`, {
                method: "GET",
                headers: analyserToken ? { Authorization: `Bearer ${analyserToken}` } : {},
                signal: controller.signal,
            })
            if (!res.ok) return empty
            const body = (await res.json()) as { workers?: AnalyserWorker[] }
            const workers = Array.isArray(body?.workers) ? body.workers : []
            for (const w of workers) {
                if (!w || typeof w.userId !== "string") continue
                empty.byUserId.set(w.userId, w)
                if (typeof w.workerId === "string" && w.workerId) {
                    empty.byWorkerId.set(w.workerId, w)
                }
            }
            return empty
        } catch {
            // Network error, timeout (abort), or malformed body — degrade.
            return empty
        } finally {
            clearTimeout(timer)
        }
    }
}
