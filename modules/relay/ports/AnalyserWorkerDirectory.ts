// Relay port — the analyser worker fleet directory. The outbound contract that
// answers "which workers does the analyser currently have a live connection
// from?". Callers depend on this role; the HTTP implementation lives in
// infrastructure and is obtained via the composition root, never constructed
// directly.

import type { AnalyserWorkers } from "./RelayTypes"

export interface AnalyserWorkerDirectory {
    /** The analyser's live worker connections. Best-effort — a transport failure,
     *  timeout, or missing config resolves to empty maps (every worker then reads
     *  as offline), never a rejection. */
    listConnected(): Promise<AnalyserWorkers>
}
