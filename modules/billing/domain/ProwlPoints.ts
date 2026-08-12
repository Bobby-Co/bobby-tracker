// Prowl Points — the currency (pure domain). Every model call the analyser runs
// comes back with a dollar cost (`cost_usd`) and/or a token count (`usage`); this
// converts that raw signal into Prowl Points, the unit users actually see and
// spend. Keeping the conversion in one pure place means the price of a call is a
// single knob (POINTS_PER_USD) rather than arithmetic scattered across call sites.

/** Prowl Points charged per US-dollar of underlying model spend. 1,000 PP ≈ $1,
 *  i.e. 1 PP ≈ a tenth of a cent. Any commercial markup is layered on top of this
 *  raw floor later; the foundation charges at cost. */
export const POINTS_PER_USD = 1_000

/** Fallback rate for calls that report tokens but no dollar cost (embeddings, the
 *  compose drafter). 1 PP per 1,000 tokens keeps cheap utility calls cheap. */
export const POINTS_PER_1K_TOKENS = 1

/** The usage signal a metered call yields — whatever subset the analyser returned. */
export interface UsageSignal {
    costUsd?: number | null
    inputTokens?: number | null
    outputTokens?: number | null
    totalTokens?: number | null
}

/** Points for a dollar cost. Rounds UP so a non-zero call never rounds to free,
 *  and floors negatives/NaN to 0. */
export function pointsFromCostUsd(costUsd: number | null | undefined): number {
    if (!costUsd || !Number.isFinite(costUsd) || costUsd <= 0) return 0
    return Math.ceil(costUsd * POINTS_PER_USD)
}

/** Points for a token count (the no-cost fallback path). */
export function pointsFromTokens(totalTokens: number | null | undefined): number {
    if (!totalTokens || !Number.isFinite(totalTokens) || totalTokens <= 0) return 0
    return Math.ceil((totalTokens / 1_000) * POINTS_PER_1K_TOKENS)
}

/** The canonical charge for a usage signal: prefer the dollar cost (the truest
 *  signal); fall back to tokens when the call reports only those. Always ≥ 0. */
export function pointsForUsage(signal: UsageSignal): number {
    const byCost = pointsFromCostUsd(signal.costUsd)
    if (byCost > 0) return byCost
    const total =
        signal.totalTokens ??
        (signal.inputTokens ?? 0) + (signal.outputTokens ?? 0)
    return pointsFromTokens(total)
}

/** Compact human formatting for a point balance: 2,000 · 40k · 1.5M. */
export function formatPoints(points: number): string {
    const n = Math.max(0, Math.round(points))
    if (n >= 1_000_000) return `${trimZero(n / 1_000_000)}M`
    if (n >= 10_000) return `${trimZero(n / 1_000)}k`
    return n.toLocaleString("en-US")
}

function trimZero(n: number): string {
    return n.toFixed(1).replace(/\.0$/, "")
}
