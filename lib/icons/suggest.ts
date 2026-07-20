import { ICONLY_CATALOG, type IconlyCatalogEntry } from "@/lib/icons/iconly-catalog"

// Local (offline) icon ranking — no network, no embeddings. Shared by the
// client picker (components/icons/icon-picker.tsx) and the server-side
// auto-icon assignment on project creation (app/api/projects/route.ts), so the
// "top suggestion" both compute means the same thing.
//
// This is deliberately kept free of any "use client" directive and of the
// server-only analyser import, so it's safe to pull into either environment.

// Returns 0 for "no match", or a value in (0, 1] reflecting the strongest tag
// confidence that matches. Slug matches always score 1.0 (the slug is
// canonical). Sorting by this keeps "true" matches above icons that merely
// picked up the term as a low-confidence software-context tag.
export function iconLocalScore(needle: string, entry: IconlyCatalogEntry): number {
    if (!needle) return 1
    if (entry.name.includes(needle)) return 1
    let best = 0
    for (const t of entry.tags) {
        if (t.name.includes(needle) && t.confidence > best) {
            best = t.confidence
        }
    }
    return best
}

export function filterIconsLocal(query: string): IconlyCatalogEntry[] {
    const needle = query.trim().toLowerCase()
    if (!needle) return ICONLY_CATALOG
    const scored: { entry: IconlyCatalogEntry; score: number }[] = []
    for (const entry of ICONLY_CATALOG) {
        const score = iconLocalScore(needle, entry)
        if (score > 0) scored.push({ entry, score })
    }
    scored.sort((a, b) => b.score - a.score)
    return scored.map((s) => s.entry)
}

export const CATALOG_BY_NAME: Record<string, IconlyCatalogEntry> = Object.fromEntries(
    ICONLY_CATALOG.map((i) => [i.name, i]),
)
