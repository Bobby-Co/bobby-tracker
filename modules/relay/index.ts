// Relay bounded context — PUBLIC CONTRACT (see modules/README.md).
// Device-pairing (code/token generation) + the analyser-worker fleet query.

// ─── pairing codes (generator) ──────────────────────────────────────────────
export { PairingCodes } from "./domain/PairingCodes"

// ─── wire types (shared with the workers UI + the fleet directory) ───────────
export type { RelayModel, RelayWorker, AnalyserWorker, AnalyserWorkers, PairingStartResult } from "./ports/RelayTypes"

// ─── analyser worker fleet directory (port + composition seam) ───────────────
// Callers depend on the AnalyserWorkerDirectory interface and obtain an
// implementation via getAnalyserWorkerDirectory(); they never construct the
// HTTP adapter directly.
export type { AnalyserWorkerDirectory } from "./ports/AnalyserWorkerDirectory"
export { getAnalyserWorkerDirectory } from "./Composition"

// ─── relay_workers persistence (port + Supabase adapter) ─────────────────────
export type { RelayWorkerRepository, RelayWorkerRow } from "./ports/RelayWorkerRepository"
export { createSupabaseRelayWorkerRepository } from "./infrastructure/SupabaseRelayWorkerRepository"
