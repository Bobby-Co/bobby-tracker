// Relay bounded context — PUBLIC CONTRACT (see modules/README.md).
// Device-pairing (code/token generation) + the analyser-worker fleet query.

// ─── pairing codes (pure value helpers) ─────────────────────────────────────
export { genDeviceCode, genUserCode, genToken, normalizeUserCode } from "./domain/PairingCodes"

// ─── wire types (shared with the workers UI + the fleet directory) ───────────
export type { RelayModel, RelayWorker, AnalyserWorker, AnalyserWorkers, PairingStartResult } from "./ports/RelayTypes"

// ─── analyser worker fleet directory (port + composition seam) ───────────────
// Callers depend on the AnalyserWorkerDirectory interface and obtain an
// implementation via getAnalyserWorkerDirectory(); they never construct the
// HTTP adapter directly.
export type { AnalyserWorkerDirectory } from "./ports/AnalyserWorkerDirectory"
export { getAnalyserWorkerDirectory } from "./Composition"
