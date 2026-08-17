// Relay module — composition root. The one place that constructs the concrete
// AnalyserWorkerDirectory. A future transport (a different fleet service, an
// in-proc stub for tests) is injected here without touching call sites — they
// depend on the port and obtain an implementation through this resolver.

import type { AnalyserWorkerDirectory } from "./ports/AnalyserWorkerDirectory"
import { HttpAnalyserWorkerDirectory } from "./infrastructure/HttpAnalyserWorkerDirectory"

/** The app-wide AnalyserWorkerDirectory (the analyser-backed HTTP adapter today). */
export function getAnalyserWorkerDirectory(): AnalyserWorkerDirectory {
    return new HttpAnalyserWorkerDirectory()
}
