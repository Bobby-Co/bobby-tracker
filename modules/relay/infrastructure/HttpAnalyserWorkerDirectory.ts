// Relay infrastructure — the HTTP AnalyserWorkerDirectory adapter. Owns all the
// vendor/IO detail of the analyser fleet query: URL normalisation, the env
// bearer token, the fetch, the 2s abort budget, and the degrade-to-empty
// behaviour. Swapping the transport = swapping this file; nothing that depends
// on the AnalyserWorkerDirectory port changes.

import type { AnalyserWorkerDirectory } from "../ports/AnalyserWorkerDirectory"
import type { AnalyserWorker, AnalyserWorkers } from "../ports/RelayTypes"

const ANALYSER_URL = process.env.BOBBY_ANALYSER_URL || ""
const ANALYSER_TOKEN = process.env.BOBBY_ANALYSER_TOKEN || ""

/** The analyser-backed AnalyserWorkerDirectory. Best-effort by contract: any
 *  error / timeout / missing config degrades to empty maps (the UI then shows
 *  every worker offline). Construct via the composition root. */
export class HttpAnalyserWorkerDirectory implements AnalyserWorkerDirectory {
    async listConnected(): Promise<AnalyserWorkers> {
        const empty: AnalyserWorkers = { byWorkerId: new Map(), byUserId: new Map() }
        if (!ANALYSER_URL) return empty

        const http = ANALYSER_URL.replace(/\/+$/, "")
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 2000)
        try {
            const res = await fetch(`${http}/relay/workers`, {
                method: "GET",
                headers: ANALYSER_TOKEN ? { Authorization: `Bearer ${ANALYSER_TOKEN}` } : {},
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
