// Analyser effort levels — pure domain, CLIENT-SAFE (no HTTP/WS client, no
// next/headers). Lives here, not in the analyser adapter, so client components
// (effort pickers) can import the constant + guard without pulling the server-
// only analyser client into the browser bundle. AnalyseEffort itself is the
// stored enum in @/lib/supabase/types.

import type { AnalyseEffort } from "@/lib/supabase/types"

export type { AnalyseEffort }

export const ANALYSE_EFFORTS: AnalyseEffort[] = ["fast", "medium", "high", "veryhigh"]

export function isAnalyseEffort(v: unknown): v is AnalyseEffort {
    return typeof v === "string" && (ANALYSE_EFFORTS as string[]).includes(v)
}
