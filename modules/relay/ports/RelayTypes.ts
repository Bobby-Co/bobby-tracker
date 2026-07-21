// Relay wire types — the contract shared with the app/(app)/workers UI and the
// analyser fleet query. The single source of truth for these shapes (the client
// components currently re-declare RelayWorker/RelayModel by hand — they should
// import from here). Pure type declarations, no runtime.

export interface RelayModel {
    id: string
    supportsTools?: boolean
    contextWindow?: number
}

export interface RelayWorker {
    id: string
    name: string
    endpoint: string | null
    models: RelayModel[]
    createdAt: string
    lastSeenAt: string | null
    /** True when the analyser currently has a live connection from this
     *  worker. Derived from AnalyserWorkerDirectory.listConnected(), defaults false. */
    online: boolean
    /** When the live connection was established, per the analyser. */
    connectedSince: string | null
}

export interface PairingStartResult {
    deviceCode: string
    userCode: string
    pairUrl: string
    interval: number
    expiresIn: number
}

/** Live-connection info the analyser reports for one worker. */
export interface AnalyserWorker {
    userId: string
    workerId?: string
    endpoint?: string
    models?: RelayModel[]
    connectedSince?: string
}

/** A live worker keyed by both workerId (preferred, when present) and
 *  userId (fallback). Callers match a DB row against either. */
export interface AnalyserWorkers {
    byWorkerId: Map<string, AnalyserWorker>
    byUserId: Map<string, AnalyserWorker>
}
