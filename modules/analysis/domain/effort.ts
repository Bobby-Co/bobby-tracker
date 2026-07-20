// Analyser effort levels — pure domain, CLIENT-SAFE (no HTTP/WS client, no
// next/headers, no SDK). The canonical home for the AnalyseEffort enum and its
// value list/guard, so client components (effort pickers) and the server client
// both import from here. The tracker.project_analyser.analyse_effort column
// stores one of these values (typed inline in @/lib/supabase/types).

export type AnalyseEffort = "fast" | "medium" | "high" | "veryhigh"

export const ANALYSE_EFFORTS: AnalyseEffort[] = ["fast", "medium", "high", "veryhigh"]

export function isAnalyseEffort(v: unknown): v is AnalyseEffort {
    return typeof v === "string" && (ANALYSE_EFFORTS as string[]).includes(v)
}
