// Domain value-object — the minimal insight shape this policy reads. Kept local
// (not the DB row type) so the status derivation stays a PURE domain rule with
// no SDK dependency; the persisted ProjectInsight row is structurally assignable.
export interface ProjectInsightView {
    open_total: number
    done_total: number
    urgent_open: number
    last_urgent_at: string | null
    last_issue_created_at: string | null
    recent_pr_opens: string[]
}

// Which footer a project tile shows, derived from its insight row (0047/0048).
//
// The "show it for a while, then go back" behaviour is a pure function of
// (row, now) — not scheduled state. A PR opened at 14:00 matches the `pr` rule
// until 20:00, and from 20:01 the same call returns `progress` instead. That is
// why recent_pr_opens stores raw timestamps rather than a count: no event fires
// when a PR stops being recent, so nothing could flip it back. Filtering the
// window here means a tile decays on its own, with no cron and no refetch.
//
// Each variant carries its own `at` — the timestamp of the thing the footer is
// actually reporting, so the time text always agrees with the text beside it.

export type ProjectStatus =
    | { kind: "progress"; done: number; total: number; at: string | null }
    | { kind: "clear"; at: string | null }
    | { kind: "critical"; count: number; at: string | null }
    | { kind: "pr"; count: number; at: string | null }

const HOUR = 3_600_000

/** How long a newly-urgent issue outranks everything else on the tile. */
export const URGENT_WINDOW_MS = 24 * HOUR
/** How long a freshly-opened PR outranks the default done/total footer. */
export const PR_WINDOW_MS = 6 * HOUR

function age(ts: string | null | undefined, now: number): number {
    if (!ts) return Infinity
    const t = Date.parse(ts)
    return Number.isNaN(t) ? Infinity : now - t
}

/** Strict priority — first match wins. Rotating between signals would just
 *  make a grid of tiles flicker, so a louder signal simply outranks a quieter
 *  one until its window lapses. */
export function pickStatus(insight: ProjectInsightView | null | undefined, now = Date.now()): ProjectStatus {
    if (!insight) return { kind: "clear", at: null }

    if (insight.urgent_open > 0 && age(insight.last_urgent_at, now) < URGENT_WINDOW_MS) {
        return { kind: "critical", count: insight.urgent_open, at: insight.last_urgent_at }
    }

    const recentPrs = (insight.recent_pr_opens ?? []).filter((t) => age(t, now) < PR_WINDOW_MS)
    if (recentPrs.length > 0) {
        // max(), not [0] — the trigger prepends, but webhook deliveries can
        // arrive out of order, so newest-first isn't guaranteed.
        const latest = recentPrs.reduce((a, b) => (Date.parse(b) > Date.parse(a) ? b : a))
        return { kind: "pr", count: recentPrs.length, at: latest }
    }

    const total = insight.open_total + insight.done_total
    if (total === 0) return { kind: "clear", at: insight.last_issue_created_at }

    return { kind: "progress", done: insight.done_total, total, at: insight.last_issue_created_at }
}
